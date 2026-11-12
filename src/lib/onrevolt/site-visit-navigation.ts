export function isSiteVisitPage(pathname: string): boolean {
  return pathname === '/admin/profile' || /^\/admin\/clients(?:\/[^/]+)?\/?$/.test(pathname);
}
