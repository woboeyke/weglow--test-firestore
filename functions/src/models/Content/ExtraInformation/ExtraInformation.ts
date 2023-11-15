import { Translation } from "../Translation";

export interface ExtraInformation {
  title: Translation[];
  content: Translation[];

  titleCentered: boolean;
}

export const defaultExtraInformation: ExtraInformation = {
  title: [],
  content: [],
  titleCentered: false,
};

export const defaultExtraInformations: ExtraInformation[] = [defaultExtraInformation];
