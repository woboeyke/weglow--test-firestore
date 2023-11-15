import { Translation } from "../Translation";

export interface Information {
  title: Translation[];
  description: Translation[];
}

export const defaultInformation: Information = {
  title: [],
  description: [],
};
