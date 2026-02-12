const axios = require('axios');
const fs = require('fs'); // Required for creating a dummy file or buffer

async function testUpload() {
    const fileName = "test.txt";
    const contentType = "text/plain";
    const fileContent = "Questo è un file di test per AnonDrop R2.";
    const fileSize = Buffer.byteLength(fileContent, 'utf8'); // Get actual byte length

    const payload = {
        fileName: fileName,
        contentType: contentType,
        fileSize: fileSize
    };

    console.log('Starting upload test...');
    console.log('Payload for presigned URL request:', payload);

    try {
        // Step 1: Get the presigned URL from our backend
        console.log('Requesting presigned URL from backend...');
        const response = await axios.post('http://localhost:3000/presigned-upload-url', payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Backend response for presigned URL:', response.data);

        const { presignedUrl, fileId } = response.data;
        console.log('Received presignedUrl:', presignedUrl);
        console.log('Received fileId:', fileId);

        // Step 2: Upload the dummy file content to the presigned URL
        console.log(`Attempting to upload file '${fileName}' (size: ${fileSize} bytes) to R2 using presigned URL...`);
        await axios.put(presignedUrl, fileContent, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': fileSize,
            }
        });
        console.log(`File '${fileName}' (ID: ${fileId}) uploaded successfully to R2!`);

        console.log('Full upload process completed successfully.');
        console.log('You can now try to download this file using the fileId:', fileId);

    } catch (error) {
        console.error('Error during full upload process:');
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('  Status:', error.response.status);
            console.error('  Headers:', error.response.headers);
            console.error('  Data:', error.response.data);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('  No response received. Request details:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('  Error message:', error.message);
        }
        console.error('  Config:', error.config);
    }
}

testUpload();
