"use strict";
const fs = require("fs-extra");
const PDFMerger = require("pdf-merger-js");
const puppeteer = require("puppeteer");
const { outputPath, overwrite, maxParallel } = require("./config.json");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function newPage(browser, cookies) {
    let page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies);
    await page.emulateMedia("screen");
    return page;
}

async function ensureGoTo(page, url) {
    let response = await page.goto(url, { "waitUntil": "networkidle2" }).catch(() => false);
    while (response && response.status() !== 200) {
        await sleep(10000);
        response = await page.reload().catch(() => false);
    }
    if (!response) {
        await sleep(10000);
        let newPage = await ensureGoTo(page, url);
        return newPage;
    }
    return page;
}

async function convertToPDF(tab, url, name, i, stylesheet) {
    let filename = `${i}.pdf`;
    let path = `${outputPath}/${name}/${filename}`;

    if (!overwrite && await fs.pathExists(path)) {
        return path;
    }

    await fs.ensureDir(path.replace(filename, ""));
    let page = await ensureGoTo(tab, url);
    await page.addStyleTag({ "content": stylesheet });

    let height = await page.evaluate(() => {
        let article = document.querySelector("#content article") || document.querySelector("#content") || document.body;
        return 0.95 * article.scrollHeight; // seems there is some extra percentage of extra length
    });
    await page.pdf({ path, height, "printBackground": true });
    return path;
}

async function scrapeGuide(guide, browser, cookies, stylesheet) {
    let { url, title } = guide;
    let path = `${outputPath}/${title}.pdf`;
    if (!overwrite && await fs.pathExists(path)) {
        console.log(path);
        return;
    }

    let merger = new PDFMerger();
    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, url);

    let pages = await page.evaluate(() => [...document.querySelectorAll("#chapters a[data-section-id]")].map(e => e.href));
    for (let i = 1; i <= pages.length; i++) {
        let path = await convertToPDF(page, pages[i - 1], title, i, stylesheet);
        merger.add(path);
        console.log(path);
    }

    await merger.save(path);
    console.log(path);
}

(async() => {
    const stylesheet = await fs.readFile("stylesheet.css", "utf8");
    const cookies = await fs.readJSON("cookies.json");
    const browser = await puppeteer.launch();

    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, "https://primagames.com/accounts/account/my_guides");
    let guides = await page.evaluate(() => [...document.querySelectorAll("a.cover")].map(e => ({
        "url":   e.href,
        "title": e.nextSiblings(".title")[0].innerText.replace(/[^A-Za-z0-9 ]+/g, "")
    })));
    await page.close();
    console.log(`Found ${guides.length} eGuides`);

    for (let i = 0; i < guides.length; i += maxParallel) {
        await Promise.all(guides.slice(i, i + maxParallel).map(guide => scrapeGuide(guide, browser, cookies, stylesheet)));
        console.log(i);
    }
    await browser.close();
    process.exit(0);
})().catch(err => {
    console.log(err);
    process.exit(1);
});
