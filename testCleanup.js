const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

async function testCleanup() {
    console.log('Starting cleanup test...');

    // 1. Upload a test file to ensure there's something to clean up
    const fileName = `cleanup-test-${uuidv4()}.txt`;
    const contentType = "text/plain";
    const fileContent = "Questo è un file di test per la pulizia di AnonDrop R2.";
    const fileSize = Buffer.byteLength(fileContent, 'utf8');
    const uploadPayload = { fileName, contentType, fileSize };
    let fileIdToClean = '';

    try {
        console.log('Uploading a test file for cleanup...');
        const uploadResponse = await axios.post('http://localhost:3000/presigned-upload-url', uploadPayload, { headers: { 'Content-Type': 'application/json' } });
        const { presignedUrl, fileId } = uploadResponse.data;
        fileIdToClean = fileId;
        console.log(`Test file '${fileName}' (ID: ${fileId}) uploaded to R2. Now storing metadata in KV.`);

        await axios.put(presignedUrl, fileContent, { headers: { 'Content-Type': contentType, 'Content-Length': fileSize } });
        console.log(`File '${fileName}' uploaded successfully to R2.`);

        // Simulate a download to trigger the downloadCount >= 1 cleanup condition
        console.log(`Simulating a download for file ID: ${fileIdToClean}`);
        await axios.get(`http://localhost:3000/api/download-info/${fileIdToClean}`);
        console.log(`Simulated download for file ID: ${fileIdToClean} successful.`);

        // 2. Call the cleanup endpoint
        console.log('Calling /cleanup-files endpoint...');
        const cleanupResponse = await axios.post('http://localhost:3000/cleanup-files');
        console.log('Cleanup endpoint response:', cleanupResponse.data);

        // 3. Verify cleanup: Attempt to download the file, expecting a 404
        console.log(`Attempting to download cleaned file (ID: ${fileIdToClean}) to verify deletion...`);
        try {
            await axios.get(`http://localhost:3000/api/download-info/${fileIdToClean}`);
            console.error('Error: File was NOT cleaned up. Download still succeeded.');
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log('Success: File not found (404) as expected. Cleanup successful!');
            } else {
                console.error('Error: Unexpected error when trying to download cleaned file:', error.response ? error.response.data : error.message);
            }
        }

    } catch (error) {
        console.error('Error during cleanup test:');
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
    console.log('Cleanup test finished.');
}

testCleanup();
