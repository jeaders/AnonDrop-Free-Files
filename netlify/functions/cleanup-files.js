import 'dotenv/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

// Cloudflare Workers KV Configuration
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_KV_NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID;

// Basic KV client for Cloudflare Workers KV
const kvClient = {
    async get(key) {
        if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_KV_NAMESPACE_ID) {
            console.warn('Cloudflare KV environment variables not set. KV operations will not work.');
            return null;
        }
        try {
            const response = await axios.get(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${key}`,
                {
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                    },
                }
            );
            return response.data;
        } catch (error) {
            console.error(`Error getting key ${key} from KV:`, error.response ? error.response.data : error.message);
            return null;
        }
    },
    async put(key, value) {
        if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_KV_NAMESPACE_ID) {
            console.warn('Cloudflare KV environment variables not set. KV operations will not work.');
            return;
        }
        try {
            await axios.put(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${key}`,
                JSON.stringify(value),
                {
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
        } catch (error) {
            console.error(`Error putting key ${key} to KV:`, error.response ? error.response.data : error.message);
        }
    },
    async delete(key) {
        if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_KV_NAMESPACE_ID) {
            console.warn('Cloudflare KV environment variables not set. KV operations will not work.');
            return;
        }
        try {
            await axios.delete(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/values/${key}`,
                {
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                    },
                }
            );
        } catch (error) {
            console.error(`Error deleting key ${key} from KV:`, error.response ? error.response.data : error.message);
        }
    },
    async list() {
        if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_KV_NAMESPACE_ID) {
            console.warn('Cloudflare KV environment variables not set. KV operations will not work.');
            return [];
        }
        try {
            const response = await axios.get(
                `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${CLOUDFLARE_KV_NAMESPACE_ID}/keys`,
                {
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                    },
                }
            );
            return response.data.result.map(keyObj => keyObj.name);
        } catch (error) {
            console.error('Error listing keys from KV:', error.response ? error.response.data : error.message);
            return [];
        }
    }
};

// R2 Configuration
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_ENDPOINT_URL = process.env.R2_ENDPOINT_URL;

const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT_URL,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});

export const handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'POST' }
        };
    }

    console.log('Starting file cleanup process...');
    try {
        const allKeys = await kvClient.list();
        let cleanedUpCount = 0;

        for (const fileId of allKeys) {
            const fileMetadata = await kvClient.get(fileId);

            if (fileMetadata && fileMetadata.r2Key) {
                const uploadDate = new Date(fileMetadata.uploadDate);
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // 1 hour in milliseconds

                // Check for auto-destruction conditions
                const shouldDelete = (
                    fileMetadata.downloadCount >= 1 || // Deleted after 1 download
                    uploadDate < oneHourAgo             // Deleted after 1 hour
                );

                if (shouldDelete) {
                    console.log(`Deleting file: ${fileMetadata.fileName} (ID: ${fileId})`);
                    // Delete from R2
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: R2_BUCKET_NAME,
                        Key: fileMetadata.r2Key,
                    });
                    await s3Client.send(deleteCommand);

                    // Delete from KV
                    await kvClient.delete(fileId);
                    cleanedUpCount++;
                }
            } else {
                // If metadata is missing or malformed, consider deleting the key from KV
                console.warn(`Malformed or missing metadata for key: ${fileId}. Deleting from KV.`);
                await kvClient.delete(fileId);
                cleanedUpCount++;
            }
        }
        console.log(`File cleanup process completed. Cleaned up ${cleanedUpCount} files.`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Cleanup successful. ${cleanedUpCount} files removed.` }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    } catch (error) {
        console.error('Error during file cleanup:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to perform file cleanup' }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    }
};
