const axios = require('axios');

async function testDownload() {
    const fileId = '73261c68-25fd-4324-8e9d-60cd85a8025e'; // Use the fileId from the successful upload

    console.log(`Starting download test for fileId: ${fileId}...`);

    try {
        // Step 1: Get the presigned download URL from our backend
        console.log('Requesting download info from backend...');
        const downloadInfoResponse = await axios.get(`http://localhost:3000/api/download-info/${fileId}`);
        console.log('Backend response for download info:', downloadInfoResponse.data);

        const { fileName, fileSize, downloadUrl } = downloadInfoResponse.data;
        console.log('Received downloadUrl:', downloadUrl);
        console.log('File Name:', fileName);
        console.log('File Size:', fileSize);

        // Step 2: Download the file content from the presigned URL
        console.log(`Attempting to download file '${fileName}' from R2 using presigned URL...`);
        const fileContentResponse = await axios.get(downloadUrl);
        const downloadedContent = fileContentResponse.data;
        console.log('File downloaded successfully!');
        console.log('Downloaded Content:', downloadedContent);

        // Verify content (optional, but good for testing)
        const originalContent = "Questo è un file di test per AnonDrop R2.";
        if (downloadedContent === originalContent) {
            console.log('Downloaded content matches original content. Download test successful!');
        } else {
            console.error('Downloaded content DOES NOT match original content. Download test FAILED!');
            console.error('Original:', originalContent);
            console.error('Downloaded:', downloadedContent);
        }

        console.log('Full download process completed.');

    } catch (error) {
        console.error('Error during full download process:');
        if (error.response) {
            console.error('  Status:', error.response.status);
            console.error('  Headers:', error.response.headers);
            console.error('  Data:', error.response.data);
        } else if (error.request) {
            console.error('  No response received. Request details:', error.request);
        } else {
            console.error('  Error message:', error.message);
        }
        console.error('  Config:', error.config);
    }
}

testDownload();
