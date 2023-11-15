import { Translation } from "../Translation";

export interface Price {
  amount: number;
  icon: string;
  label: Translation[];
}

export const defaultPrice: Price = {
  amount: 5,
  icon: "",
  label: [],
};

export const defaultPrices: Price[] = [
  {
    amount: 5,
    icon: "candle",
    label: [],
  },
  {
    amount: 10,
    icon: "candle",
    label: [],
  },
  {
    amount: 25,
    icon: "candle",
    label: [],
  },
];
