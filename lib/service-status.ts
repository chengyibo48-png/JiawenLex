export interface ServiceStatus { id: "website" | "smtp" | "backup" | "ai"; configured: boolean; missing: string[] }
export function serviceStatus(env: Record<string, string | undefined>, validPublicUrl: boolean): ServiceStatus[] {
  const groups: [ServiceStatus["id"], string[]][] = [
    ["website", ["NEXT_PUBLIC_SITE_URL"]],
    ["smtp", ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]],
    ["backup", ["BACKUP_S3_ENDPOINT", "BACKUP_S3_REGION", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_ENCRYPTION_SECRET"]],
    ["ai", ["AI_KEY_ENCRYPTION_SECRET"]],
  ];
  return groups.map(([id, names]) => {
    const missing = names.filter((name) => !env[name]?.trim());
    if (id === "website" && !validPublicUrl && !missing.includes("NEXT_PUBLIC_SITE_URL")) missing.push("NEXT_PUBLIC_SITE_URL");
    const encryption = id === "backup" ? "BACKUP_ENCRYPTION_SECRET" : id === "ai" ? "AI_KEY_ENCRYPTION_SECRET" : null;
    if (encryption && (env[encryption]?.length ?? 0) < 32 && !missing.includes(encryption)) missing.push(encryption);
    return { id, configured: !missing.length, missing };
  });
}
