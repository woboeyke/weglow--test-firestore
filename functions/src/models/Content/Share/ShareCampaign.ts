import { Translation } from "../Translation";
import { ShareOption, defaultShareOptions } from "./ShareOption";

export interface ShareCampaign {
  shareOptions: ShareOption[];
  enableCopyLink: boolean;
  title: Translation[];
}

export const defaultShareCampaign: ShareCampaign = {
  enableCopyLink: true,
  shareOptions: defaultShareOptions,
  title: [],
};
