
export interface ModOfTheDay {
    Title: string;
    "Resource URL": string;
    Version: string;
    "Thumbnail URL": string;
    Author: string;
    "Posted Date": string;
    "Updated Date": string;
    Downloads: string;
    Subscriptions: string;
    Rating: string;
}

export async function fetchModOfTheDay(): Promise<ModOfTheDay> {
    // Updated URL to point directly to the sheet data
    const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSbBk4haED28w-IscFPBq5e5ECDj62TJjCzGiL1f5z8jldR7GXqVP-oeY6AmNZQ5PpJ07zfWJI1vRxp/pubhtml/sheet?headers=false&gid=0";
    
    // Fetch the published HTML from Google Sheets
    const html = await fetch(url).then(res => res.text());

    // Parse HTML into a DOM
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Find the Google Sheets table
    const table = doc.querySelector("table.waffle");
    if (!table) throw new Error("Google Sheets table not found in HTML");

    // Extract headers from the first row of tbody
    const headerRow = table.querySelector("tbody tr");
    if (!headerRow) throw new Error("No header row found");
    
    const headerCells = headerRow.querySelectorAll("td");
    const headers = [...headerCells].map(td => td.textContent?.trim() || "");

    // Extract the data from the second row of tbody
    const rows = table.querySelectorAll("tbody tr");
    if (rows.length < 2) throw new Error("No data rows found");
    
    const dataRow = rows[1]; // Second row
    const rowCells = dataRow.querySelectorAll("td");
    const values = [...rowCells].map(td => td.textContent?.trim() || "");

    // Build the final key/value object
    const result: any = {};
    headers.forEach((header, i) => {
        if (header) {
            result[header] = values[i] ?? "";
        }
    });

    return result as ModOfTheDay;
}
