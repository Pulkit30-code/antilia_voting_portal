import "server-only";

import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { Election } from "@/lib/elections/service";
import type { ElectionResults, HodBallot, Turnout } from "@/lib/reporting/service";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export type ElectionExportData = {
  election: Election;
  results: ElectionResults;
  turnout: Turnout;
  ballots: HodBallot[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MIME_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function exportFilename(election: Election, format: ExportFormat): string {
  const month = MONTHS[election.month - 1] ?? `Month_${election.month}`;
  return `Antilia_Voting_${month}_${election.year}.${format}`;
}

export function exportMimeType(format: ExportFormat): string {
  return MIME_TYPES[format];
}

function monthYear(election: Election): string {
  return `${MONTHS[election.month - 1] ?? `Month ${election.month}`} ${election.year}`;
}

function exportDate(value: string | null): string {
  if (!value) return "Not recorded";
  return `${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value))} IST`;
}

function winnerName(data: ElectionExportData, category: "FOH" | "BOH"): string {
  const result = data.results[category];
  return result.candidates.find((candidate) => candidate.candidateId === result.winnerCandidateId)?.name
    ?? (result.tieDetected ? "Tie unresolved" : "Not determined");
}

function categoryVotes(data: ElectionExportData, category: "FOH" | "BOH"): number {
  return data.results[category].candidates[0]?.categoryVoteCount ?? 0;
}

function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsvExport(data: ElectionExportData): Uint8Array {
  const rows: Array<Array<string | number | boolean | null>> = [
    ["Election summary"],
    ["Election name", data.election.name],
    ["Month / year", monthYear(data.election)],
    ["Election status", data.election.status],
    ["Opened at", data.election.openedAt],
    ["Closed at", data.election.closedAt],
    ["FOH winner", winnerName(data, "FOH")],
    ["BOH winner", winnerName(data, "BOH")],
    ["FOH vote total", categoryVotes(data, "FOH")],
    ["BOH vote total", categoryVotes(data, "BOH")],
    ["Total eligible HODs", data.turnout.totalEligibleHods],
    ["Completed ballots", data.turnout.completedHods],
    ["Pending HOD count", data.turnout.pendingHods],
    ["Turnout percentage", data.turnout.turnoutPercentage],
    [],
    ["Candidate results"],
    ["Category", "Rank", "Candidate", "Department", "Vote total", "Category vote total", "Percentage", "Winner"],
  ];

  for (const category of ["FOH", "BOH"] as const) {
    for (const candidate of data.results[category].candidates) {
      rows.push([
        category,
        candidate.rank,
        candidate.name,
        candidate.department,
        candidate.voteCount,
        candidate.categoryVoteCount,
        candidate.votePercentage,
        candidate.candidateId === data.results[category].winnerCandidateId ? "Yes" : "No",
      ]);
    }
  }

  rows.push(
    [],
    ["HOD participation"],
    ["HOD", "Department", "Participation", "FOH choice", "BOH choice", "Submitted at"],
  );
  for (const ballot of data.ballots) {
    rows.push([
      ballot.hodName,
      ballot.department,
      ballot.hasVoted ? "Completed" : "Pending",
      ballot.fohCandidateName,
      ballot.bohCandidateName,
      ballot.submittedAt,
    ]);
  }

  return new TextEncoder().encode(`\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`);
}

const excelColors = {
  ink: "FF25231F",
  muted: "FF716A60",
  gold: "FFB99A5F",
  goldPale: "FFF5EFE3",
  header: "FF26241F",
  white: "FFFFFFFF",
  line: "FFE5DED2",
};

function styleTitle(sheet: ExcelJS.Worksheet, title: string, endColumn: number): void {
  sheet.mergeCells(2, 1, 2, endColumn);
  const cell = sheet.getCell(2, 1);
  cell.value = title;
  cell.font = { name: "Arial", size: 16, bold: true, color: { argb: excelColors.ink } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(2).height = 26;
  for (let column = 1; column <= endColumn; column += 1) {
    sheet.getCell(3, column).border = { bottom: { style: "thin", color: { argb: excelColors.gold } } };
  }
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: excelColors.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelColors.header } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
}

function applyBodyStyle(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (!cell.font) cell.font = { name: "Arial", size: 10, color: { argb: excelColors.ink } };
    cell.alignment = { ...cell.alignment, vertical: "middle" };
  }));
  sheet.views = [{ showGridLines: false }];
  sheet.properties.defaultRowHeight = 20;
}

export async function createExcelExport(data: ElectionExportData): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Antilia Voting Portal";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = `${monthYear(data.election)} election results`;

  const summary = workbook.addWorksheet("Summary", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  styleTitle(summary, "Antilia Voting Results", 4);
  summary.addRow([]);
  const summaryHeader = summary.addRow(["Election details", "Value", "Participation", "Value"]);
  styleHeader(summaryHeader);
  const summaryRows: Array<[string, string | number | Date, string, string | number]> = [
    ["Election name", data.election.name, "Total eligible HODs", data.turnout.totalEligibleHods],
    ["Month / year", monthYear(data.election), "Completed ballots", data.turnout.completedHods],
    ["Election status", data.election.status, "Pending HOD count", data.turnout.pendingHods],
    ["Opened at", data.election.openedAt ? new Date(data.election.openedAt) : "Not recorded", "Turnout percentage", data.turnout.turnoutPercentage / 100],
    ["Closed at", data.election.closedAt ? new Date(data.election.closedAt) : "Not recorded", "FOH vote total", categoryVotes(data, "FOH")],
    ["FOH winner", winnerName(data, "FOH"), "BOH vote total", categoryVotes(data, "BOH")],
    ["BOH winner", winnerName(data, "BOH"), "", ""],
  ];
  summary.addRows(summaryRows);
  summary.getCell(9, 2).numFmt = "dd mmm yyyy, hh:mm";
  summary.getCell(10, 2).numFmt = "dd mmm yyyy, hh:mm";
  summary.getCell(9, 4).numFmt = "0.0%";
  summary.columns = [{ width: 23 }, { width: 32 }, { width: 24 }, { width: 18 }];
  applyBodyStyle(summary);

  const candidates = workbook.addWorksheet("Candidate Results", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  styleTitle(candidates, "Candidate Results", 8);
  candidates.addRow([]);
  const candidateHeader = candidates.addRow(["Category", "Rank", "Candidate", "Department", "Vote total", "Category total", "Percentage", "Winner"]);
  styleHeader(candidateHeader);
  for (const category of ["FOH", "BOH"] as const) {
    for (const candidate of data.results[category].candidates) {
      const row = candidates.addRow([
        category, candidate.rank, candidate.name, candidate.department, candidate.voteCount,
        candidate.categoryVoteCount, candidate.votePercentage / 100,
        candidate.candidateId === data.results[category].winnerCandidateId ? "Yes" : "No",
      ]);
      row.getCell(7).numFmt = "0.0%";
      if (row.getCell(8).value === "Yes") {
        row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelColors.goldPale } }; });
      }
    }
  }
  candidates.columns = [{ width: 12 }, { width: 9 }, { width: 27 }, { width: 24 }, { width: 13 }, { width: 15 }, { width: 14 }, { width: 11 }];
  candidates.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  candidates.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 8 } };
  applyBodyStyle(candidates);

  const participation = workbook.addWorksheet("HOD Participation", { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  styleTitle(participation, "HOD Participation and Ballot Choices", 6);
  participation.addRow([]);
  const participationHeader = participation.addRow(["HOD", "Department", "Participation", "FOH choice", "BOH choice", "Submitted at"]);
  styleHeader(participationHeader);
  for (const ballot of data.ballots) {
    const row = participation.addRow([
      ballot.hodName,
      ballot.department,
      ballot.hasVoted ? "Completed" : "Pending",
      ballot.fohCandidateName ?? "",
      ballot.bohCandidateName ?? "",
      ballot.submittedAt ? new Date(ballot.submittedAt) : "",
    ]);
    row.getCell(6).numFmt = "dd mmm yyyy, hh:mm";
  }
  participation.columns = [{ width: 26 }, { width: 23 }, { width: 15 }, { width: 27 }, { width: 27 }, { width: 25 }];
  participation.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  participation.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 6 } };
  applyBodyStyle(participation);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

function pdfText(value: string | number | null): string {
  if (value === null || value === "") return "Not recorded";
  return String(value)
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 3))}...`;
}

type PdfWriter = {
  document: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
};

const PDF_SIZE: [number, number] = [841.89, 595.28];
const PDF_MARGIN = 38;

function addPdfPage(writer: PdfWriter): void {
  writer.page = writer.document.addPage(PDF_SIZE);
  writer.y = PDF_SIZE[1] - 64;
}

function ensurePdfSpace(writer: PdfWriter, height: number): void {
  if (writer.y - height < 45) addPdfPage(writer);
}

function drawSectionTitle(writer: PdfWriter, title: string): void {
  ensurePdfSpace(writer, 34);
  writer.page.drawText(pdfText(title), { x: PDF_MARGIN, y: writer.y, font: writer.bold, size: 13, color: rgb(0.19, 0.17, 0.13) });
  writer.page.drawLine({ start: { x: PDF_MARGIN, y: writer.y - 7 }, end: { x: PDF_SIZE[0] - PDF_MARGIN, y: writer.y - 7 }, thickness: 1, color: rgb(0.73, 0.6, 0.37) });
  writer.y -= 25;
}

function drawTable(
  writer: PdfWriter,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  widths: number[],
): void {
  const rowHeight = 20;
  const drawHeader = () => {
    writer.page.drawRectangle({ x: PDF_MARGIN, y: writer.y - rowHeight + 5, width: widths.reduce((a, b) => a + b, 0), height: rowHeight, color: rgb(0.15, 0.14, 0.12) });
    let x = PDF_MARGIN;
    headers.forEach((header, index) => {
      writer.page.drawText(truncate(pdfText(header), Math.floor(widths[index] / 5.8)), { x: x + 5, y: writer.y - 8, font: writer.bold, size: 7.5, color: rgb(1, 1, 1) });
      x += widths[index];
    });
    writer.y -= rowHeight;
  };
  ensurePdfSpace(writer, rowHeight * 2);
  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (writer.y - rowHeight < 45) {
      addPdfPage(writer);
      drawHeader();
    }
    if (rowIndex % 2 === 1) {
      writer.page.drawRectangle({ x: PDF_MARGIN, y: writer.y - rowHeight + 5, width: widths.reduce((a, b) => a + b, 0), height: rowHeight, color: rgb(0.97, 0.96, 0.94) });
    }
    let x = PDF_MARGIN;
    row.forEach((value, index) => {
      writer.page.drawText(truncate(pdfText(value), Math.floor(widths[index] / 5.3)), { x: x + 5, y: writer.y - 8, font: writer.regular, size: 7.5, color: rgb(0.2, 0.19, 0.17) });
      x += widths[index];
    });
    writer.y -= rowHeight;
  });
  writer.y -= 10;
}

export async function createPdfExport(data: ElectionExportData): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`${data.election.name} - ${monthYear(data.election)}`);
  document.setAuthor("Antilia Voting Portal");
  document.setSubject("Election results and HOD participation");
  const writer: PdfWriter = {
    document,
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    page: document.addPage(PDF_SIZE),
    y: PDF_SIZE[1] - 64,
  };

  writer.page.drawText("ANTILIA", { x: PDF_MARGIN, y: writer.y, font: writer.bold, size: 10, color: rgb(0.73, 0.6, 0.37) });
  writer.y -= 26;
  writer.page.drawText("Voting results", { x: PDF_MARGIN, y: writer.y, font: writer.bold, size: 24, color: rgb(0.12, 0.11, 0.09) });
  writer.y -= 22;
  writer.page.drawText(pdfText(`${data.election.name} | ${monthYear(data.election)}`), { x: PDF_MARGIN, y: writer.y, font: writer.regular, size: 10, color: rgb(0.38, 0.35, 0.3) });
  writer.y -= 30;

  drawSectionTitle(writer, "Election summary");
  drawTable(writer, ["Election", "Status", "Opened at", "Closed at"], [[data.election.name, data.election.status, exportDate(data.election.openedAt), exportDate(data.election.closedAt)]], [210, 80, 235, 235]);
  drawTable(writer, ["FOH winner", "BOH winner", "Eligible HODs", "Completed", "Pending", "Turnout"], [[winnerName(data, "FOH"), winnerName(data, "BOH"), data.turnout.totalEligibleHods, data.turnout.completedHods, data.turnout.pendingHods, `${data.turnout.turnoutPercentage.toFixed(1)}%`]], [180, 180, 100, 100, 90, 110]);

  drawSectionTitle(writer, "Candidate results");
  const candidateRows: Array<Array<string | number | null>> = [];
  for (const category of ["FOH", "BOH"] as const) {
    for (const candidate of data.results[category].candidates) {
      candidateRows.push([category, candidate.rank, candidate.name, candidate.department, candidate.voteCount, candidate.categoryVoteCount, `${candidate.votePercentage.toFixed(1)}%`, candidate.candidateId === data.results[category].winnerCandidateId ? "Yes" : "No"]);
    }
  }
  drawTable(writer, ["Category", "Rank", "Candidate", "Department", "Votes", "Category total", "Share", "Winner"], candidateRows, [65, 45, 165, 145, 65, 95, 75, 65]);

  drawSectionTitle(writer, "HOD participation and ballot choices");
  drawTable(
    writer,
    ["HOD", "Department", "Participation", "FOH choice", "BOH choice", "Submitted at"],
    data.ballots.map((ballot) => [ballot.hodName, ballot.department, ballot.hasVoted ? "Completed" : "Pending", ballot.fohCandidateName, ballot.bohCandidateName, exportDate(ballot.submittedAt)]),
    [135, 120, 90, 145, 145, 125],
  );

  const pages = document.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: PDF_MARGIN, y: 34 }, end: { x: PDF_SIZE[0] - PDF_MARGIN, y: 34 }, thickness: 0.5, color: rgb(0.84, 0.81, 0.75) });
    page.drawText("Private HR / SYSTEM report", { x: PDF_MARGIN, y: 20, font: writer.regular, size: 7, color: rgb(0.48, 0.45, 0.4) });
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    page.drawText(pageLabel, { x: PDF_SIZE[0] - PDF_MARGIN - writer.regular.widthOfTextAtSize(pageLabel, 7), y: 20, font: writer.regular, size: 7, color: rgb(0.48, 0.45, 0.4) });
  });

  return document.save();
}

export async function createElectionExport(data: ElectionExportData, format: ExportFormat): Promise<Uint8Array> {
  if (format === "csv") return createCsvExport(data);
  if (format === "xlsx") return createExcelExport(data);
  return createPdfExport(data);
}
