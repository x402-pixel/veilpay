import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum InvoiceType { STANDARD = 0, MULTI_PAY = 1, DONATION = 2 }

export enum InvoiceStatus { ACTIVE = 0, PAID = 1, SETTLED = 2, CANCELLED = 3 }

export type InvoiceOpening = { amount: bigint;
                               tokenColor: Uint8Array;
                               merchantCoinPk: Uint8Array;
                               invoiceType: InvoiceType;
                               paymentSecret: Uint8Array;
                               salt: Uint8Array
                             };

export type InvoiceState = { commitment: Uint8Array;
                             merchantAuth: Uint8Array;
                             invoiceType: InvoiceType;
                             expiresAt: bigint;
                             status: InvoiceStatus
                           };

export type Witnesses<PS> = {
  merchantSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  invoiceOpening(context: __compactRuntime.WitnessContext<Ledger, PS>,
                 invoiceId_0: bigint): [PS, InvoiceOpening];
  receiptSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  issueInvoice(context: __compactRuntime.CircuitContext<PS>,
               amount_0: bigint,
               tokenColor_0: Uint8Array,
               merchantCoinPk_0: Uint8Array,
               invoiceType_0: InvoiceType,
               expiresAt_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  settleStandard(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                             value: { nonce: Uint8Array,
                                                                                      color: Uint8Array,
                                                                                      value: bigint
                                                                                    }
                                                                           },
                                                                   sent: { nonce: Uint8Array,
                                                                           color: Uint8Array,
                                                                           value: bigint
                                                                         }
                                                                 }>;
  settleMultiPayment(context: __compactRuntime.CircuitContext<PS>,
                     invoiceId_0: bigint,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint,
                               mt_index: bigint
                             }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               },
                                                                       sent: { nonce: Uint8Array,
                                                                               color: Uint8Array,
                                                                               value: bigint
                                                                             }
                                                                     }>;
  acceptDonation(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         },
                 amount_0: bigint): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                    value: { nonce: Uint8Array,
                                                                                             color: Uint8Array,
                                                                                             value: bigint
                                                                                           }
                                                                                  },
                                                                          sent: { nonce: Uint8Array,
                                                                                  color: Uint8Array,
                                                                                  value: bigint
                                                                                }
                                                                        }>;
  settleMulti(context: __compactRuntime.CircuitContext<PS>, invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelInvoice(context: __compactRuntime.CircuitContext<PS>,
                invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  issueInvoice(context: __compactRuntime.CircuitContext<PS>,
               amount_0: bigint,
               tokenColor_0: Uint8Array,
               merchantCoinPk_0: Uint8Array,
               invoiceType_0: InvoiceType,
               expiresAt_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  settleStandard(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                             value: { nonce: Uint8Array,
                                                                                      color: Uint8Array,
                                                                                      value: bigint
                                                                                    }
                                                                           },
                                                                   sent: { nonce: Uint8Array,
                                                                           color: Uint8Array,
                                                                           value: bigint
                                                                         }
                                                                 }>;
  settleMultiPayment(context: __compactRuntime.CircuitContext<PS>,
                     invoiceId_0: bigint,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint,
                               mt_index: bigint
                             }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               },
                                                                       sent: { nonce: Uint8Array,
                                                                               color: Uint8Array,
                                                                               value: bigint
                                                                             }
                                                                     }>;
  acceptDonation(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         },
                 amount_0: bigint): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                    value: { nonce: Uint8Array,
                                                                                             color: Uint8Array,
                                                                                             value: bigint
                                                                                           }
                                                                                  },
                                                                          sent: { nonce: Uint8Array,
                                                                                  color: Uint8Array,
                                                                                  value: bigint
                                                                                }
                                                                        }>;
  settleMulti(context: __compactRuntime.CircuitContext<PS>, invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelInvoice(context: __compactRuntime.CircuitContext<PS>,
                invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  issueInvoice(context: __compactRuntime.CircuitContext<PS>,
               amount_0: bigint,
               tokenColor_0: Uint8Array,
               merchantCoinPk_0: Uint8Array,
               invoiceType_0: InvoiceType,
               expiresAt_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  settleStandard(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                             value: { nonce: Uint8Array,
                                                                                      color: Uint8Array,
                                                                                      value: bigint
                                                                                    }
                                                                           },
                                                                   sent: { nonce: Uint8Array,
                                                                           color: Uint8Array,
                                                                           value: bigint
                                                                         }
                                                                 }>;
  settleMultiPayment(context: __compactRuntime.CircuitContext<PS>,
                     invoiceId_0: bigint,
                     coin_0: { nonce: Uint8Array,
                               color: Uint8Array,
                               value: bigint,
                               mt_index: bigint
                             }): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               },
                                                                       sent: { nonce: Uint8Array,
                                                                               color: Uint8Array,
                                                                               value: bigint
                                                                             }
                                                                     }>;
  acceptDonation(context: __compactRuntime.CircuitContext<PS>,
                 invoiceId_0: bigint,
                 coin_0: { nonce: Uint8Array,
                           color: Uint8Array,
                           value: bigint,
                           mt_index: bigint
                         },
                 amount_0: bigint): __compactRuntime.CircuitResults<PS, { change: { is_some: boolean,
                                                                                    value: { nonce: Uint8Array,
                                                                                             color: Uint8Array,
                                                                                             value: bigint
                                                                                           }
                                                                                  },
                                                                          sent: { nonce: Uint8Array,
                                                                                  color: Uint8Array,
                                                                                  value: bigint
                                                                                }
                                                                        }>;
  settleMulti(context: __compactRuntime.CircuitContext<PS>, invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  cancelInvoice(context: __compactRuntime.CircuitContext<PS>,
                invoiceId_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly sequence: bigint;
  invoices: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): InvoiceState;
    [Symbol.iterator](): Iterator<[bigint, InvoiceState]>
  };
  receipts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Uint8Array;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
