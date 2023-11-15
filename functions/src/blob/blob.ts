import * as functions from "firebase-functions";
import * as azure from "azure-storage";
import { ImageBlob } from "../models/ImageBlob";
import { checkIfCorrectCampaign } from "../auth/authChecks";
import { logEvent, logException } from "../helpers/errorLogging";

const blobSvc = azure.createBlobService(
  "weglowdashboard",
  "zot98zn5chQvbDn1YuyGnhQIBwfTHuRHYGwvkJeAwv401kZlK8/CS4Rl0+Jt7aAeQ57+Ild2kZNS+ASt0ZvXFQ==",
);

export const getSASurl = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const blobName = data.blobName as string;
    const containerName = data.containerName as string;
    await checkIfCorrectCampaign(context.auth, containerName);

    const blobSAS = blobSvc.generateSharedAccessSignature(containerName, blobName, {
      AccessPolicy: {
        Permissions: azure.BlobUtilities.SharedAccessPermissions.WRITE,
        Start: azure.date.minutesFromNow(-5),
        Expiry: azure.date.minutesFromNow(60),
      },
    });
    const sasUrl = blobSvc.getUrl(containerName, blobName, blobSAS);

    logEvent("getSASurl", { blobName, containerName, sasUrl });

    return sasUrl;
  } catch (error: unknown) {
    logException(error, { blobName: data.blobName, containerName: data.containerName, message: (error as Error)?.message }, "Error getting SAS url");
  }
});

export const createContainer = (containerName: string) => {
  try {
    return new Promise((resolve, reject) => {
      const options = { publicAccessLevel: "blob" } as azure.BlobService.CreateContainerOptions;
      blobSvc.createContainerIfNotExists(containerName, options, (error, result) => {
        if (error || !result) {
          console.error("Error while creating blob container: ", error);
          reject(error);
        }
        resolve(result);
      });
    });
  } catch (error: unknown) {
    logException(error, { containerName });
  }
};

export const deleteContainer = (containerName: string) => {
  try {
    return new Promise((resolve, reject) => {
      console.log("Deleting container", containerName);
      blobSvc.deleteContainerIfExists(containerName, (error, result) => {
        if (error || !result) {
          console.error("Error while deleting blob container: ", error);
          reject(error);
        }
        resolve(result);
      });
    });
  } catch (error: unknown) {
    logException(error, { containerName });
  }
};

export const renameContainer = (containerName: string, newContainerName: string) => {
  try {
    return new Promise((resolve, reject) => {
      try {
        logEvent("renameContainer", { containerName, newContainerName });

        blobSvc.createContainerIfNotExists(newContainerName, (error, result) => {
          if (error || !result) {
            console.error("Blob rename: Error while creating blob container:", error);
            reject(error);
          }
          blobSvc.listBlobsSegmented(containerName, null as any, (error, result2) => {
            if (error || !result2) {
              console.error("Blob rename: Error while listing blobs:", error);
              reject(error);
            }
            result2.entries.forEach((blob) => {
              blobSvc.startCopyBlob(blob.name, newContainerName, blob.name, (error, result3) => {
                if (error || !result3) {
                  console.error("Blob rename: Error while copying blob:", error);
                  reject(error);
                }
                blobSvc.deleteBlobIfExists(containerName, blob.name, (error, result4) => {
                  if (error || !result4) {
                    console.error("Blob rename: Error while deleting blob:", error);
                    reject(error);
                  }
                  resolve(result4);
                });
              });
            });
          });
        });
      } catch (error) {
        console.error(error);
        reject(error);
      }
    });
  } catch (error: unknown) {
    logException(error, { containerName, newContainerName });
  }
};

export const getAllImages = functions.region("europe-west1").https.onCall(async (data, context) => {
  try {
    const projectId = data.projectId as string;
    await checkIfCorrectCampaign(context.auth, projectId);

    const blobs = await new Promise<azure.BlobService.BlobResult[]>((resolve, reject) => {
      blobSvc.listBlobsSegmented(projectId, null as any, (error, result) => {
        if (error || !result) {
          console.error("Error while listing blobs:", error);
          reject(error);
        }
        resolve(result.entries);
      });
    });
    return blobs.map((blob) => {
      return {
        fileName: blob.name,
        url: blobSvc.getUrl(projectId, blob.name),
        created: blob.creationTime,
        lastModified: blob.lastModified,
        size: blob.contentLength,
      } as ImageBlob;
    });
  } catch (error: unknown) {
    logException(error, { projectId: data.projectId });
  }
});
