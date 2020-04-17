"use strict";
const IO = require("fs-extra");
const PDFMerger = require("pdf-merger-js");
const Throttle = require("promise-parallel-throttle");
const Puppeteer = require("puppeteer");
const { outputPath, overwrite, maxInProgress, maxRetries, minBytes } = require("./config.json");

async function newPage(browser, cookies) {
    let page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies);
    await page.emulateMedia("screen");
    return page;
}

async function ensureFileSize(fn, path) {
    await fn();
    let retries = 0;
    let { size } = await IO.stat(path);
    while (size < minBytes && retries < maxRetries) {
        retries++;
        await fn();
        ({ size } = await IO.stat(path));
    }
    return retries >= maxRetries;
}

async function ensureGoTo(page, url) {
    let response = await page.goto(url, { "waitUntil": "networkidle0" }).catch(() => false);
    while (response && response.status() !== 200) {
        await page.waitFor(10000);
        response = await page.reload().catch(() => false);
    }
    if (!response) {
        await page.waitFor(10000);
        let newPage = await ensureGoTo(page, url);
        return newPage;
    }
    return page;
}

async function convertToPDF(tab, url, name, i, stylesheet) {
    let filename = `${i}.pdf`;
    let path = `${outputPath}/${name}/${filename}`;

    if (!overwrite && await IO.pathExists(path)) {
        return path;
    }

    await IO.ensureDir(path.replace(filename, ""));
    let page = await ensureGoTo(tab, url);
    await page.addStyleTag({ "content": stylesheet });

    let height = await page.evaluate(() => {
        let article = document.querySelector("#content article") || document.querySelector("#content") || document.body;
        return article.scrollHeight;
    });
    let fn = async() => {
        await page.waitFor(1000);
        await page.pdf({ path, height, "printBackground": true });
    };
    await ensureFileSize(fn, path);
    return path;
}

async function scrapeGuide(guide, browser, cookies, stylesheet) {
    let { url, title } = guide;
    let path = `${outputPath}/${title}.pdf`;
    if (!overwrite && await IO.pathExists(path)) {
        console.log(path);
        return;
    }

    let merger = new PDFMerger();
    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, url);

    let pages = await page.evaluate(() => [...document.querySelectorAll("#toc a[data-section-id]")].map(e => e.href));
    for (let i = 1; i <= pages.length; i++) {
        let path = await convertToPDF(page, pages[i - 1], title, i, stylesheet);
        merger.add(path);
        console.log(path);
    }

    let fn = async() => { await merger.save(path); };
    await ensureFileSize(fn, path);
    await page.close();
    await IO.remove(`${outputPath}/${title}/`);
    console.log(path);
}

(async() => {
    const stylesheet = await IO.readFile("stylesheet.css", "utf8");
    const cookies = await IO.readJSON("cookies.json");
    const browser = await Puppeteer.launch();

    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, "https://primagames.com/accounts/account/my_guides");
    let guides = await page.evaluate(() => [...document.querySelectorAll("a.cover")].map(e => ({
        "url":   e.href,
        "title": e.nextSiblings(".title")[0].innerText.replace(/[^A-Za-z0-9 ]+/g, "").replace(/[ ]+/g, " ")
    })));
    await page.close();
    console.log(`Found ${guides.length} eGuides`);

    await Throttle.all(guides.map(guide => () => scrapeGuide(guide, browser, cookies, stylesheet)), { maxInProgress });
    await browser.close();
    process.exit(0);
})().catch(err => {
    console.log(err);
    process.exit(1);
});
