# Offline PrimaGames eGuides
![](https://eguides.primagames.com/localstatic/img/logo.png)

## Description
Download [your eGuides from PrimaGames](https://eguides.primagames.com/accounts/account/my_guides) for offline use.

## Requirements
 * [Node.js](https://nodejs.org/en/)
 * [EditThisCookie](http://www.editthiscookie.com/) or [Cookie-Editor](https://cookie-editor.cgagnier.ca/)
 * ☆ Star this repository

## Instructions
1. Download/clone this repository
2. Run `npm install`
3. Edit `config.json` to change settings, like output path
4. [Login to PrimaGames](https://eguides.primagames.com/accounts/login)
5. Export your cookies and save them to `cookies.json`<br>Format: `[{name, value, domain, path}, { ... }, ...]`
6. Run `node index.js` or `npm start`

## Tips
1. If it fails and the `overwrite` option is set to false, simply restart and it keep your previous progression.
2. Because all raw web data is being stored in the output pdf, I highly recommend compressing the pdf's afterwards. Example with [ghostscript](https://www.ghostscript.com/releases/gsdnld.html):
```bash
MKDIR C:\eguides\compressed
FOR %i IN (C:\eguides\*.pdf) DO start gswin64c -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dBATCH -sOutputFile="C:\eguides\compressed\%~ni.pdf" "C:\eguides\%~ni.pdf"
```

## Warning
Depending on your settings and number of guide, this can be quite resource-intensive, since it runs a headless browser in the background.
Ensure you allocate enough system resources and space beforehand!
