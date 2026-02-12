require('dotenv').config(); // Per caricare le variabili d'ambiente localmente

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');

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

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'GET' }
        };
    }

    const fileId = event.path.split('/').pop(); // Estrai fileId dall'URL

    if (!fileId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'File ID is required' })
        };
    }

    try {
        const fileMetadata = await kvClient.get(fileId);

        if (!fileMetadata) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'File not found' }),
                headers: { 'Content-Type': 'application/json' }
            };
        }

        // Increment download count
        fileMetadata.downloadCount++;
        await kvClient.put(fileId, fileMetadata);

        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: fileMetadata.r2Key,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        return {
            statusCode: 200,
            body: JSON.stringify({
                fileName: fileMetadata.fileName,
                fileSize: fileMetadata.fileSize,
                downloadUrl: presignedUrl,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    } catch (error) {
        console.error('Error generating presigned download URL:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to generate presigned download URL' }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    }
};
