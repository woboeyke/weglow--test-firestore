import { Content } from "../models/Content/Content";
import { Style } from "../models/Content/Style/Style";

export const validateContent = (content: Content) => {
  if (!content) {
    throw new Error("Content cannot be null");
  }

  if (content.shareCampaign.shareOptions.length > 10) {
    throw new Error("Share options cannot be more than 10");
  }
  if (content.buyCandle.prices.length > 5) {
    throw new Error("Prices cannot be more than 5");
  }

  if (content.buyCandle.prices.length < 1) {
    throw new Error("Prices cannot be less than 1");
  }

  if (content.buyCandle.prices.some((price) => price.amount < 1)) {
    throw new Error("Price amount cannot be less than 1");
  }
  if (content.buyCandle.prices.some((price) => price.amount > 999)) {
    throw new Error("Price amount cannot be more than 999");
  }

  if (content.buyCandle.allowAnonymousDonations && content.buyCandle.emailRequired) {
    throw new Error("Anonymous donations cannot require email");
  }

  validateStyle(content.style);
};

const validateStyle = (style: Style) => {
  const keys = Object.keys(style);

  for (const key of keys) {
    if (style[key as keyof Style] === null || style[key as keyof Style] === undefined) {
      throw new Error(`${key} is required`);
    }
  }

  if (style.font.label.length > 50) {
    throw new Error("Font family cannot be more than 50 characters");
  }

  const colorKeys = Object.keys(style.colors);
  for (const colorKey of colorKeys) {
    const color = style.colors[colorKey as keyof Style["colors"]];
    if (!color.match(/^#[0-9a-f]{6}$/i)) {
      throw new Error(`${colorKey} is not a valid hex color`);
    }
  }
};
