import { Translation } from "../Translation";
import { Price, defaultPrices } from "./Price";

export interface BuyCandle {
  title: Translation[];
  description: Translation[];
  currency: string;
  prices: Price[];
  emailRequired: boolean;
  fiscalCertificateEnabled: boolean;
  allowAnonymousDonations: boolean;
}

export const defaultBuyCandle: BuyCandle = {
  currency: "€",
  title: [],
  description: [],
  prices: defaultPrices,
  emailRequired: false,
  fiscalCertificateEnabled: false,
  allowAnonymousDonations: false,
};
