const express = require('express');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.post('/download', async (req, res) => {
    const { url } = req.body;
    const videosDir = path.join(__dirname, 'public', 'videos');
    fs.mkdirSync(videosDir, { recursive: true });

    try {
        const info = await youtubedl(url, {
            dumpSingleJson: true,
            noCheckCertificate: true,
            noWarnings: true,
        });

        const safeTitle = info.title
            .replace(/ /g, '_')
            .substring(0, 80);

        // Let yt-dlp decide the best container
        const outputPath = path.join(videosDir, `${safeTitle}.%(ext)s`);

        await youtubedl(url, {
            output: outputPath,
            format: 'bestvideo+bestaudio/best',
            noCheckCertificate: true,
            noWarnings: true,
        });

        // Get the actual file that was created
        const files = fs.readdirSync(videosDir);
        const downloadedFile = files.find(f => f.startsWith(safeTitle));
        
        if (!downloadedFile) {
            throw new Error("Downloaded file not found");
        }

        res.json({ 
            success: true, 
            file: `/videos/${downloadedFile}`,
            title: info.title 
        });

    } catch (err) {
        console.error(err);
        res.json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));