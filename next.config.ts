import type { NextConfig } from 'next';

const config: NextConfig = {
  // Mail libraries are plain Node packages; load them at runtime instead of bundling.
  serverExternalPackages: ['smtp-server', 'mailparser', 'nodemailer', 'mammoth', 'html-to-docx', 'exceljs', 'pptxgenjs', 'libsql'],
  devIndicators: false,
};

export default config;
