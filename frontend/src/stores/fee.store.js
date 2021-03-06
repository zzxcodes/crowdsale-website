import BigNumber from 'bignumber.js';
import { action, observable } from 'mobx';

import appStore from './app.store';
import config from './config.store';
import storage from './storage';
import Transaction from './transaction';

import picopsBackend from '../picops-backend';
import { isValidAddress } from '../utils';

// Gas Limit of 200k gas
const FEE_REGISTRAR_GAS_LIMIT = new BigNumber('0x30d40');
// Signature of `pay(address)`
const FEE_REGISTRAR_PAY_SIGNATURE = '0x0c11dedd';

class FeeStore {
  fee = new BigNumber(0);
  feeRegistrar = null;
  txFee = new BigNumber(0);

  // The transaction hash for the Fee Registrar
  @observable transaction;

  constructor () {
    // Load after the config store
    config.ready(this.load);
  }

  get totalFee () {
    return this.fee.add(this.txFee);
  }

  load = async () => {
    console.warn('loading fee store...');

    try {
      // Retrieve the fee
      const { fee, feeRegistrar } = await picopsBackend.fee();

      this.fee = fee;
      this.feeRegistrar = feeRegistrar;
      this.txFee = config.get('gasPrice').mul(FEE_REGISTRAR_GAS_LIMIT);
    } catch (error) {
      appStore.addError(error);
    }

    this.loadStorage();
  };

  loadStorage () {
    const transaction = storage.get('fee-transaction');

    this.setTransaction(transaction);
  }

  async sendPayment (who, privateKey) {
    try {
      if (!isValidAddress(who)) {
        throw new Error('invalid payer address: ' + who);
      }

      const transaction = new Transaction(privateKey, { picops: true });

      const calldata = FEE_REGISTRAR_PAY_SIGNATURE + who.slice(-40).padStart(64, 0);
      const { hash } = await transaction.send({
        data: calldata,
        gasLimit: FEE_REGISTRAR_GAS_LIMIT,
        to: this.feeRegistrar,
        value: this.fee
      });

      console.warn('sent FeeRegistrar tx', hash);
      this.setTransaction(hash);
    } catch (error) {
      appStore.addError(error);
    }
  }

  @action setTransaction (transaction) {
    this.transaction = transaction;
    storage.set('fee-transaction', transaction);
  }
}

export default new FeeStore();
