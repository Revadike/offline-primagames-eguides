"use strict";
const fs = require("fs-extra");
const PDFMerger = require("pdf-merger-js");
const puppeteer = require("puppeteer");
const { outputPath, overwrite } = require("./config.json");

async function ensureGoTo(page, url) {
    let response = await page.goto(url, { "waitUntil": "networkidle2" });
    while (response.status() !== 200) {
        response = page.reload();
    }
    return page;
}

async function convertToPDF(page, url, name, i, stylesheet) {
    let filename = `${i}.pdf`;
    let path = `${outputPath}/${name}/${filename}`;

    if (!overwrite && await fs.pathExists(path)) {
        return path;
    }

    await fs.ensureDir(path.replace(filename, ""));
    page = await ensureGoTo(page, url);
    await page.addStyleTag({ "content": stylesheet });

    let height = await page.evaluate(() => {
        let article = document.querySelector("#content article") || document.querySelector("#content") || document.body;
        return article.scrollHeight;
    });
    await page.pdf({ path, height, "printBackground": true });
    return path;
}

(async() => {
    const stylesheet = await fs.readFile("stylesheet.css", "utf8");
    const cookies = await fs.readJSON("cookies.json");
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies);
    await page.emulateMedia("screen");
    page = await ensureGoTo(page, "https://primagames.com/accounts/account/my_guides");
    let guides = await page.evaluate(() => [...document.querySelectorAll("a.cover")].map(e => ({
        "url":   e.href,
        "title": e.nextSiblings(".title")[0].innerText.replace(/[^A-Za-z0-9 ]+/g, "")
    })));

    for (let guide of guides) {
        let merger = new PDFMerger();
        let { url, title } = guide;
        page = await ensureGoTo(page, url);

        let pages = await page.evaluate(() => [...document.querySelectorAll("#chapters a[data-section-id]")].map(e => e.href));
        for (let i = 1; i <= pages.length; i++) {
            let path = await convertToPDF(page, pages[i - 1], title, i, stylesheet);
            console.log(path);
            merger.add(path);
        }

        let savePath = `${outputPath}/${title}.pdf`;
        if (!overwrite && await fs.pathExists(savePath)) {
            console.log(savePath);
            continue;
        }

        await merger.save(savePath);
        console.log(savePath);
    }

    await browser.close();
    process.exit(0);
})().catch(err => {
    console.log(err);
    process.exit(1);
});
