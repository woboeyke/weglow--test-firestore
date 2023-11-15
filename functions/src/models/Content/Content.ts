import { BuyCandle, defaultBuyCandle } from "./BuyCandle/BuyCandle";
import { Information, defaultInformation } from "./Information/Information";
import { ShareCampaign, defaultShareCampaign } from "./Share/ShareCampaign";
import { Map, defaultMap } from "./Map/Map";
import { ExtraInformation, defaultExtraInformations } from "./ExtraInformation/ExtraInformation";
import { Style, defaultStyle } from "./Style/Style";
import { Mail, defaultMail } from "./Mail/Mail";
import { Meta, defaultMeta } from "./Meta/Meta";

export interface Content {
  information: Information;
  shareCampaign: ShareCampaign;
  buyCandle: BuyCandle;
  map: Map;
  extraInformation: ExtraInformation[];
  extraPage: ExtraInformation[];
  style: Style;
  mail: Mail;
  meta: Meta;

  headerImageURL: string;
  realCampaignSiteURL: string;
  totalDonatedURL: string;
  candleImageURL: string;
  hasEndDate: boolean;

  countdownDate?: string;
}

export interface ContentDTO extends Content {
  totalDonated?: number;
  totalDonations?: number;
  analyticsId?: string;
}

export const defaultContent: Content = {
  candleImageURL: "",
  headerImageURL: "",
  realCampaignSiteURL: "",
  totalDonatedURL: "",
  hasEndDate: true,

  shareCampaign: defaultShareCampaign,
  buyCandle: defaultBuyCandle,
  information: defaultInformation,
  map: defaultMap,
  extraInformation: defaultExtraInformations,
  extraPage: defaultExtraInformations,
  style: defaultStyle,
  mail: defaultMail,
  meta: defaultMeta,
};
