import { validateContent } from "../content/validateContent";
import { ICampaign } from "../models/Campaign";
import { PaymentMethod } from "../models/Payment";

export const validateCampaign = (campaign: ICampaign) => {
  if (!campaign) {
    throw new Error("Campaign cannot be null");
  }

  if (!campaign.id) {
    throw new Error("Campaign id is required");
  }
  validateId(campaign.id);

  validateContent(campaign.content);

  if (campaign.paymentMethod != PaymentMethod.Payconiq && campaign.content.buyCandle.fiscalCertificateEnabled) {
    throw new Error("Fiscal certificate can only be enabled for Payconiq campaigns");
  }
};

const validateId = (id: string) => {
  const regex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  const minLength = 3;
  const maxLength = 63;

  if (id.length < minLength || id.length > maxLength) {
    throw new Error(`Campaign id must be between ${minLength} and ${maxLength} characters`);
  }

  if (!regex.test(id)) {
    throw new Error("Campaign id can only contain lowercase letters, numbers and dashes");
  }
};
