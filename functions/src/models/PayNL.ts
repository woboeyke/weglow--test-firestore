export interface IPayNLAmount {
  value: string;
  currency: string;
}

export interface IPayNLTransactionStatusResponse {
  request: {
    result: string;
    errorId: string;
    errorMessage: string;
  };
  paymentDetails: {
    transactionId: string;
    orderId: string;
    paymentProfileId: string;
    state: string;
    stateName: string;
    amountOriginal: IPayNLAmount;
    amount: IPayNLAmount;
    amountPaidOriginal: IPayNLAmount;
    amountPaid: IPayNLAmount;
    amountRefundOriginal: IPayNLAmount;
    created: string;
    identifierName: string;
    identifierPublic: string;
    identifierHash: string;
    startIpAddress: string;
    completedIpAddress: string;
    orderNumber: string;
  }
}
