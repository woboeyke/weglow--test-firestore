import { Content } from "./Content/Content";
import { PaymentInfo, PaymentMethod } from "./Payment";

export interface CampaignAnalytics {
  propertyId: string;
  measurementId: string;
}

export interface CampaignListItem {
  label: string;
  id: string;
  legacy: boolean;
}

export interface ICampaign {
  id: string;
  displayName: string;
  analytics: CampaignAnalytics;
  endDate: string;
  paymentMethod: PaymentMethod;
  content: Content;
  paymentInfo: PaymentInfo;
  updateNumber: number;
  customURL?: string;
}
