require('dotenv').config(); // Per caricare le variabili d'ambiente localmente

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
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
    // delete and list methods are not needed for this specific function, but kept for consistency if kvClient is shared
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

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' }),
            headers: { 'Allow': 'POST' }
        };
    }

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON body' })
        };
    }

    const { fileName, contentType, fileSize } = body;

    if (!fileName || !contentType || !fileSize) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'fileName, contentType, and fileSize are required' })
        };
    }

    const fileId = uuidv4();
    const key = `uploads/${fileId}/${fileName}`;

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        ContentLength: fileSize,
    });

    try {
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        await kvClient.put(fileId, {
            fileName: fileName,
            contentType: contentType,
            fileSize: fileSize,
            uploadDate: new Date().toISOString(),
            downloadCount: 0,
            r2Key: key,
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ presignedUrl, fileId }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    } catch (error) {
        console.error('Error generating presigned upload URL:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to generate presigned upload URL' }),
            headers: {
                'Content-Type': 'application/json',
            },
        };
    }
};
