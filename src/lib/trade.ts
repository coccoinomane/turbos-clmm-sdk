import {
  JsonRpcProvider,
  SUI_CLOCK_OBJECT_ID,
  SuiAddress,
  SuiTransactionBlockResponse,
  TransactionBlock,
} from '@mysten/sui.js';
import { Base } from './base';
import Decimal from 'decimal.js';
import { Pool } from './pool';

const ONE_MINUTE = 60 * 1000;

export declare module Trade {
  export interface SwapOptions {
    pools: [singlePool: string] | [firstPool: string, secondPool: string];
    priceLimit:
      | [singlePool: Decimal.Value]
      | [firstPool: Decimal.Value, secondPool: Decimal.Value];
    /**
     * Coin type such as `0x2::sui::SUI`
     */
    coins: [a: string, b: string];
    address: SuiAddress;
    amount: Decimal.Value;
    amountThreshold: Decimal.Value;
    exactIn: boolean;
    signAndExecute: (
      txb: TransactionBlock,
      provider: JsonRpcProvider,
    ) => Promise<SuiTransactionBlockResponse>;
  }
}

export class Trade extends Base {
  async swap(options: Trade.SwapOptions) {
    const {
      pools,
      priceLimit,
      coins,
      address,
      amount,
      amountThreshold,
      exactIn,
      signAndExecute,
    } = options;
    const contract = await this.contract.getConfig();
    const [coinTypeA, coinTypeB] = coins;
    const coinA = await this.coin.getMetadata(coinTypeA);
    const bigAmountA = this.math.scaleUp(amount, coinA.decimals);
    const coinIds = await this.coin.selectTradeCoins(address, coinTypeA, bigAmountA);
    const { functionName, typeArguments } = this.getFunctionNameAndTypeArguments(
      await Promise.all(pools.map((pool) => this.pool['getPoolTypeArguments'](pool))),
      coinTypeA,
      coinTypeB,
    );

    const txb = new TransactionBlock();
    txb.moveCall({
      target: `${contract.PackageId}::swap_router::${functionName}`,
      typeArguments: typeArguments,
      arguments: [
        ...pools.map((pool) => txb.object(pool)),
        txb.makeMoveVec({
          objects: this.coin.convertTradeCoins(txb, coinIds, coinTypeA, bigAmountA),
        }),
        txb.pure(bigAmountA.toFixed(0), 'u64'),
        txb.pure(new Decimal(amountThreshold).toFixed(0), 'u64'),
        ...priceLimit.map((price) => txb.pure(price, 'u128')),
        txb.pure(exactIn, 'bool'),
        txb.object(address),
        txb.pure(Date.now() + ONE_MINUTE * 3, 'u64'),
        txb.object(SUI_CLOCK_OBJECT_ID),
        txb.object(contract.Versioned),
      ],
    });

    return signAndExecute(txb, this.provider);
  }

  protected getFunctionNameAndTypeArguments(
    pools: Pool.Types[],
    coinTypeA: string,
    coinTypeB: string,
  ) {
    let typeArguments: string[];
    const functionName: string[] = ['swap'];
    if (pools.length === 1) {
      typeArguments = pools[0]!;
      if (coinTypeA === typeArguments[0]) {
        functionName.push('a', 'b');
      } else {
        functionName.push('b', 'a');
      }
    } else {
      const pool1Args = pools[0]!;
      const pool2Args = pools[1]!;
      let coinTypeC: string;
      if (coinTypeA === pool1Args[0]) {
        functionName.push('a', 'b');
        coinTypeC = pool1Args[1];
      } else {
        functionName.push('b', 'a');
        coinTypeC = pool1Args[0];
      }
      if (coinTypeB === pool2Args[0]) {
        functionName.push('c', 'b');
      } else {
        functionName.push('b', 'c');
      }
      typeArguments = [coinTypeA, pool1Args[2], coinTypeB, pool2Args[2], coinTypeC];
    }

    return {
      functionName: functionName.join('_'),
      typeArguments,
    };
  }
}
