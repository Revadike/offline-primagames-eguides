"use strict";
const IO = require("fs-extra");
const PDFMerger = require("pdf-merger-js");
const Throttle = require("promise-parallel-throttle");
const Puppeteer = require("puppeteer");
const { keepTemp, maxInProgress, maxRetries, minBytes, outputPath, overwrite } = require("./config.json");

async function newPage(browser, cookies) {
    let page = await browser.newPage();
    await page.setJavaScriptEnabled(true);
    await page.setDefaultNavigationTimeout(90000);
    await page.setCookie(...cookies);
    await page.emulateMedia("screen");
    return page;
}

async function ensureGoTo(page, url, retries = 0) {
    let retry = retries;
    let response = await page.goto(url, { "waitUntil": "networkidle0" }).catch(() => false);

    while (response && response.status() !== 200 && retry < maxRetries) {
        await page.waitFor(10000);
        retry++;
        response = await page.reload().catch(() => false);
    }

    if (!response && retry < maxRetries) {
        await page.waitFor(10000);
        let newPage = await ensureGoTo(page, url, ++retry);
        return newPage;
    }

    return retry < maxRetries ? page : false;
}

async function ensurePDFSize(page, path, height) {
    await page.waitFor(1000);
    await page.pdf({ path, height, "printBackground": true });

    let retries = 0;
    let { size } = await IO.stat(path);
    while (size < minBytes && retries < maxRetries) {
        await page.waitFor(1000);
        await page.pdf({ path, height, "printBackground": true });

        retries++;
        ({ size } = await IO.stat(path));
    }

    return retries >= maxRetries;
}

async function convertToPDF(tab, url, name, i, stylesheet) {
    let filename = `${i}.pdf`;
    let path = `${outputPath}/${name}/${filename}`;

    if (!overwrite && await IO.pathExists(path)) {
        return path;
    }

    await IO.ensureDir(path.replace(filename, ""));
    let page = await ensureGoTo(tab, url);
    if (!page) {
        return false;
    }

    await page.addStyleTag({ "content": stylesheet });
    let height = await page.evaluate(() => {
        let article = document.querySelector("#content article") || document.querySelector("#content") || document.body;
        return article.scrollHeight;
    });

    await ensurePDFSize(page, path, height);
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
    if (!page) {
        console.log(`Failed to fetch ${url}`);
        return;
    }

    let pages = await page.evaluate(() => [...document.querySelectorAll("#toc a[data-section-id]")].map(e => e.href));
    if (pages.length === 0) {
        console.log(`No pages found for ${title}`);
        return;
    }

    for (let i = 1; i <= pages.length; i++) {
        let path = await convertToPDF(page, pages[i - 1], title, i, stylesheet);
        if (path) {
            merger.add(path);
            console.log(path);
        } else {
            console.log(`Failed to fetch ${pages[i - 1]}`);
        }
    }

    await merger.save(path);
    await page.close();
    console.log(path);

    if (!keepTemp) {
        await IO.remove(`${outputPath}/${title}/`);
    }
}

(async() => {
    const stylesheet = await IO.readFile("stylesheet.css", "utf8");
    const cookies = await IO.readJSON("cookies.json");
    const browser = await Puppeteer.launch();

    let page = await newPage(browser, cookies);
    page = await ensureGoTo(page, "https://primagames.com/accounts/account/my_guides");
    if (!page) {
        throw new Error("Unable to fetch PrimaGames eGuides");
    }

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
