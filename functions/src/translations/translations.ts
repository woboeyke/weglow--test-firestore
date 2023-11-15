import * as functions from "firebase-functions";
import * as deepl from "deepl-node";
import { TargetLanguageCode } from "deepl-node";
import { deeplKey } from "../secrets/deepl";
import { logException, logTrace } from "../helpers/errorLogging";
const translator = new deepl.Translator(deeplKey);

// Test API: https://www.deepl.com/docs-api/simulator
const translateTextWithDeepl = async (text: string, targetLanguage: string, allowedLanguages: string[]) => {
  try {
    const formattedTargetLanguage = mapTargetLanguage(targetLanguage, allowedLanguages);
    logTrace(`Translating to: ${formattedTargetLanguage}`);
    const options = {
      preserveFormatting: true,
      tagHandling: "html",
      ignoreTags: ["ph"],
    } as deepl.TranslateTextOptions;
    const translatedText = await translator.translateText(text, null, formattedTargetLanguage, options).then((data: deepl.TextResult) => {
      return data.text;
    });

    return translatedText;
  } catch (error: unknown) {
    logException(error, { text, targetLanguage, allowedLanguages, error }, "Error translating text", "invalid-argument");
  }
};

const mapTargetLanguage = (targetLanguage: string, allowedLanguages: string[]) => {
  try {
    const firstPart = targetLanguage.split("-")[0];
    const secondPart = targetLanguage.split("-")[1];

    if (allowedLanguages.includes(targetLanguage)) {
      return targetLanguage as TargetLanguageCode;
    } else if (allowedLanguages.includes(firstPart)) {
      return firstPart as TargetLanguageCode;
    } else if (allowedLanguages.includes(secondPart.toLowerCase())) {
      return secondPart.toLowerCase() as TargetLanguageCode;
    } else if (allowedLanguages.includes(secondPart.toUpperCase())) {
      return secondPart.toUpperCase() as TargetLanguageCode;
    } else {
      throw new functions.https.HttpsError("invalid-argument", `Target language ${targetLanguage} is not supported`);
    }
  } catch (error: unknown) {
    const firstPart = targetLanguage ? targetLanguage.split("-").length > 0 ? targetLanguage.split("-")[0] : "" : "";
    const secondPart = targetLanguage ? targetLanguage.split("-").length > 1 ? targetLanguage.split("-")[1] : "" : "";

    return logException(error, { targetLanguage, allowedLanguages, firstPart, secondPart });
  }
};

export const translate = async (text: string, targetLanguage: string) => {
  const allowedLocales = await getAllowedLocales();
  return await translateTextWithDeepl(text, targetLanguage, allowedLocales);
};

export const translateText = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const text = data.text as string;
    const targetLanguage = data.targetLanguage as string;

    if (!text) {
      throw new functions.https.HttpsError("invalid-argument", "Text not provided");
    }

    if (!targetLanguage) {
      throw new functions.https.HttpsError("invalid-argument", "Target language not provided");
    }

    return await translate(text, targetLanguage);
  } catch (error: unknown) {
    logException(error, { text: data?.text, targetLanguage: data?.targetLanguage });
  }
});

export const updateMissingTranslations = async (content: any, allLanguages: string[], allowedLocales?: string[]) => {
  try {
    if (!allowedLocales) {
      allowedLocales = await getAllowedLocales();
    }

    if (Array.isArray(content)) {
      for (const item of content) {
        await updateMissingTranslations(item, allLanguages, allowedLocales);
      }
    } else if (typeof content === "object") {
      for (const key in content) {
        if (Array.isArray(content[key])) {
          // eslint-disable-next-line no-prototype-builtins
          if (content[key].every((item: any) => item.hasOwnProperty("locale") && item.hasOwnProperty("value"))) {
            const originalTranslation = content[key].find((t: any) => allLanguages.includes(t.locale) && t.value);
            if (originalTranslation) {
              for (const lang of allLanguages) {
                const existingTranslation = content[key].find((t: any) => t.locale === lang);
                if (!existingTranslation) {
                  logTrace(`Missing translation for ${key}, '${originalTranslation.value}' in ${lang}`, { key, originalTranslation: originalTranslation.value, lang, existingTranslation, content });
                  const translatedText = await translateTextWithDeepl(originalTranslation.value, lang, allowedLocales);
                  content[key].push({ locale: lang, value: translatedText });
                  logTrace(`Added translation for ${key}, '${originalTranslation.value}' in ${lang}`, { key, originalTranslation: originalTranslation.value, lang, existingTranslation, content });
                }
              }
            }
          } else {
            // Recursively update translations inside nested arrays
            for (const item of content[key]) {
              await updateMissingTranslations(item, allLanguages, allowedLocales);
            }
          }
        } else {
          await updateMissingTranslations(content[key], allLanguages, allowedLocales);
        }
      }
    }
  } catch (error: unknown) {
    logException(error, { content, allLanguages, allowedLocales });
  }
};

export const getAllowedLocales = async () => {
  return (await translator.getTargetLanguages()).map((lang: deepl.Language) => lang.code as string) as string[];
};
