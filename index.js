require('dotenv').config();

console.log('CLOUDFLARE_ACCOUNT_ID:', process.env.CLOUDFLARE_ACCOUNT_ID);
console.log('CLOUDFLARE_API_TOKEN:', process.env.CLOUDFLARE_API_TOKEN ? '********' : 'NOT SET'); // Mask token for security
console.log('CLOUDFLARE_KV_NAMESPACE_ID:', process.env.CLOUDFLARE_KV_NAMESPACE_ID);

const express = require('express');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios'); // Import axios

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

// Endpoint to get a presigned URL for uploading a file
app.post('/presigned-upload-url', async (req, res) => {
    const { fileName, contentType, fileSize } = req.body;

    if (!fileName || !contentType || !fileSize) {
        return res.status(400).json({ error: 'fileName, contentType, and fileSize are required' });
    }

    const fileId = uuidv4(); // Generate a unique ID for the file
    const key = `uploads/${fileId}/${fileName}`; // Store in a unique path in R2

    const command = new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
        ContentLength: fileSize,
    });

    try {
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour

        // Store file metadata in Replit DB
        await kvClient.put(fileId, {
            fileName: fileName,
            contentType: contentType,
            fileSize: fileSize,
            uploadDate: new Date().toISOString(),
            downloadCount: 0,
            r2Key: key, // Store the R2 key to retrieve the file later
        });

        res.json({ presignedUrl, fileId });
    } catch (error) {
        console.error('Error generating presigned upload URL:', error);
        res.status(500).json({ error: 'Failed to generate presigned upload URL' });
    }
});

// Endpoint to get file metadata and a presigned URL for downloading a file
app.get('/api/download-info/:fileId', async (req, res) => {
    const { fileId } = req.params;

    try {
        const fileMetadata = await kvClient.get(fileId);

        if (!fileMetadata) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Increment download count
        fileMetadata.downloadCount++;
        await kvClient.put(fileId, fileMetadata);

        const command = new GetObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: fileMetadata.r2Key,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // URL expires in 1 hour

        res.json({
            fileName: fileMetadata.fileName,
            fileSize: fileMetadata.fileSize,
            downloadUrl: presignedUrl,
        });

    } catch (error) {
        console.error('Error generating presigned download URL:', error);
        res.status(500).json({ error: 'Failed to generate presigned download URL' });
    }
});

// Serve the download.html for any /download/:fileId route
app.get('/download/:fileId', (req, res) => {
    res.sendFile(__dirname + '/public/download.html');
});

// Endpoint for cleaning up old/downloaded files
app.post('/cleanup-files', async (req, res) => {
    console.log('Starting file cleanup process...');
    try {
        const allKeys = await kvClient.list(); // Get all keys from Replit DB
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

                    // Delete from Replit DB
                    await kvClient.delete(fileId);
                    cleanedUpCount++;
                }
            } else {
                // If metadata is missing or malformed, consider deleting the key from DB
                console.warn(`Malformed or missing metadata for key: ${fileId}. Deleting from KV.`);
                await kvClient.delete(fileId);
                cleanedUpCount++;
            }
        }
        console.log(`File cleanup process completed. Cleaned up ${cleanedUpCount} files.`);
        res.status(200).json({ message: `Cleanup successful. ${cleanedUpCount} files removed.` });
    } catch (error) {
        console.error('Error during file cleanup:', error);
        res.status(500).json({ error: 'Failed to perform file cleanup' });
    }
});

app.listen(port, () => {
    console.log(`AnonDrop R2 backend listening at http://localhost:${port}`);
});
