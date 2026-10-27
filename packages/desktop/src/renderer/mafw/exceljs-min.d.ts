// exceljs 浏览器独立包（UMD）无类型声明；我们只经动态 import 使用其运行时。
declare module "exceljs/dist/exceljs.min.js" {
  const ExcelJS: any
  export default ExcelJS
}
