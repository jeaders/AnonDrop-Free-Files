import 'dotenv/config';

console.log('CLOUDFLARE_ACCOUNT_ID:', process.env.CLOUDFLARE_ACCOUNT_ID);
console.log('CLOUDFLARE_API_TOKEN:', process.env.CLOUDFLARE_API_TOKEN ? '********' : 'NOT SET'); // Mask token for security
console.log('CLOUDFLARE_KV_NAMESPACE_ID:', process.env.CLOUDFLARE_KV_NAMESPACE_ID);

import express from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import axios from 'axios'; // Import axios

const app = express();
const port = 3000;

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
            console.log(`KV get response for key ${key}:`, response.data); // Added log
            return response.data; // axios already parses JSON if Content-Type is application/json
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
                JSON.stringify(value), // KV stores strings, so stringify JSON
                {
                    headers: {
                        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json',
                    },
                }
            );
            console.log(`KV put successful for key ${key}`); // Added log
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

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.static('public'));

// R2 Configuration (PLACEHOLDERS - PLEASE PROVIDE YOUR ACTUAL KEYS)
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '0e9e51c62389c19cac618ecb7fa011e6';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'cbdef8abec24610c17efc25a17f22398e8ccdc018e291e9a9028d017a19b8c67';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'anondrop-files'; // Confirmed from your API key
const R2_ENDPOINT_URL = process.env.R2_ENDPOINT_URL || 'https://bee1cdac1697fdfaab090aa40a1bfae2.r2.cloudflarestorage.com'; // Confirmed from your API key

const s3Client = new S3Client({
    region: 'auto', // Cloudflare R2 uses 'auto' for region
    endpoint: R2_ENDPOINT_URL,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});





// Serve the download.html for any /download/:fileId route
app.get('/download/:fileId', (req, res) => {
    res.sendFile(__dirname + '/public/download.html');
});



app.listen(port, () => {
    console.log(`AnonDrop R2 backend listening at http://localhost:${port}`);
});
