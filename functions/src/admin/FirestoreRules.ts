import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { logException, logTrace } from "../helpers/errorLogging";

export const newRule = async (ruleName: string) => {
  if (!ruleName) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid rule name");
  }

  try {
    (await admin.securityRules().getFirestoreRuleset()).source.forEach(async (rule) => {
      const newRule = `match /${ruleName}/{documents=**} { allow read; }`;
      const rulesMatch = rule.content.match(/service cloud\.firestore \{([\s\S]*)\}/);
      const existingRules = rulesMatch ? rulesMatch[1].trim() : "";

      const startOfMatchBlock = existingRules.indexOf("match /databases/{database}/documents");

      let endOfMatchBlock = startOfMatchBlock + 1; // Start searching from the character after the opening curly brace
      let openBracesCount = 1;

      while (openBracesCount > 0 && endOfMatchBlock < existingRules.length) {
        if (existingRules[endOfMatchBlock] === "{") {
          openBracesCount++;
        } else if (existingRules[endOfMatchBlock] === "}") {
          openBracesCount--;
        }
        endOfMatchBlock++;
      }

      const modifiedRules =
        "rules_version = '2';\n" +
        "service cloud.firestore {\n\t" +
        existingRules.slice(0, endOfMatchBlock - 1) + "\n\t\t" + newRule + "\n\t" + existingRules.slice(endOfMatchBlock - 1) +
        "\n}";

      await admin.securityRules().releaseFirestoreRulesetFromSource(modifiedRules);

      logTrace("Firestore rule created successfully!", { ruleName });
    });
  } catch (error: unknown) {
    logException(error, { ruleName: ruleName }, "Error creating Firestore rule");
  }
};

export const editRule = async (oldRuleName: string, newRuleName: string) => {
  if (!oldRuleName || !newRuleName) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid rule name");
  }

  const firestore = admin.securityRules();

  try {
    const rf = await firestore.getFirestoreRuleset();
    const rulesMatch = rf.source[0].content.match(/service cloud\.firestore \{([\s\S]*)\}/);
    const existingRules = rulesMatch ? rulesMatch[1].trim() : "";

    // Find the index of the old rule
    const oldRuleIndex = existingRules.indexOf(`match /${oldRuleName}/{documents=**} { allow`);

    if (oldRuleIndex === -1) {
      throw new Error(`Rule "${oldRuleName}" not found.`);
    }

    // Find the start and end of the block containing the old rule
    const startOfMatchBlock = existingRules.lastIndexOf("match /databases/{database}/documents", oldRuleIndex);
    const endOfMatchBlock = existingRules.indexOf("}", oldRuleIndex) + 1;

    const modifiedRules =
      "rules_version = '2';\n" +
      "service cloud.firestore {\n\t" +
      existingRules.slice(0, startOfMatchBlock) +
      existingRules.slice(startOfMatchBlock, endOfMatchBlock).replace(oldRuleName, newRuleName) + "\t" +
      existingRules.slice(endOfMatchBlock) +
      "\n}";

    await firestore.releaseFirestoreRulesetFromSource(modifiedRules);

    logTrace("Firestore rule edited successfully!", { oldRuleName, newRuleName });
  } catch (error: unknown) {
    logException(error, { oldRuleName: oldRuleName, newRuleName: newRuleName }, "Error editing Firestore rule");
  }
};

// This can probably be improved
export const deleteRule = async (ruleName: string) => {
  if (!ruleName) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid rule name");
  }

  const firestore = admin.securityRules();

  try {
    const rf = await firestore.getFirestoreRuleset();
    const rulesMatch = rf.source[0].content.match(/service cloud\.firestore \{([\s\S]*)\}/);
    const existingRules = rulesMatch ? rulesMatch[1].trim() : "";

    // Find the index of the rule to delete
    const rule = `match /${ruleName}/{documents=**}`;
    const ruleIndex = existingRules.indexOf(rule);

    if (ruleIndex === -1) {
      throw new Error(`Rule "${ruleName}" not found.`);
    }

    // Find the index of the next occurrence of '{ allow read; }'
    const nextReadIndex = existingRules.indexOf("{ allow read; }", ruleIndex);

    if (nextReadIndex === -1) {
      throw new Error("Could not find '{ allow read; }' after the rule to delete.");
    }

    // Get the part of the rules before and after the rule to delete
    let modifiedRules =
      "rules_version = '2';\n" +
      "service cloud.firestore {\n\t" +
      existingRules.slice(0, nextReadIndex).trim();
    modifiedRules = modifiedRules.slice(0, modifiedRules.length - rule.length).trim() + "\n\t}\n}";

    await firestore.releaseFirestoreRulesetFromSource(modifiedRules);

    logTrace("Firestore rule deleted successfully!", { ruleName });
  } catch (error: unknown) {
    logException(error, { ruleName: ruleName }, "Error deleting Firestore rule");
  }
};
