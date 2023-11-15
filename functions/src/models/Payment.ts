export interface Payment {
  number: number;
  name: string;
  description: string;
  lat: number;
  lng: number;
  flames: number;
  date: FirebaseFirestore.Timestamp;
  email?: string;
  orderId?: string;
}

export interface PaymentDto {
  number: number;
  name: string;
  description: string;
  lat: number;
  lng: number;
  flames: number;
  date: string;
  email?: string;
  orderId?: string;
}

export enum PaymentMethod {
  PayNL = "PayNL",
  Payconiq = "Payconiq",
}

export interface PaymentInfo {
  payNLServiceId?: string;
  payconiqApiKey?: string;
  paymentMethod: PaymentMethod;
}

export const defaultPaymentInfo: PaymentInfo = {
  payNLServiceId: "",
  paymentMethod: PaymentMethod.PayNL,
};
