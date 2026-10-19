import ExcelJS from 'exceljs';
import type { Response } from 'express';
export type ExportColumn={header:string;format?:'money'|'date';width?:number};
/** Values are primitives or Dates. User strings are never interpreted as formulas. */
export async function sendXlsx(res:Response,name:string,columns:ExportColumn[],rows:unknown[][]) {
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="${name}"`);
  const book=new ExcelJS.stream.xlsx.WorkbookWriter({stream:res,useStyles:true,useSharedStrings:false});
  const sheet=book.addWorksheet('Export',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=columns.map(c=>({header:c.header,width:c.width??28,style:{numFmt:c.format==='money'?'#,##0.00':c.format==='date'?'dd/mm/yyyy':'General'}}));
  sheet.getRow(1).font={bold:true};sheet.getRow(1).commit();
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
  for(const row of rows)sheet.addRow(row.map(v=>v==null?null:v instanceof Date||typeof v==='number'||typeof v==='boolean'?v:String(v))).commit();
  await book.commit();
}
