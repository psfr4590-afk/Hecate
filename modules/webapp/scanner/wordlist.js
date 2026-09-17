'use strict';

/**
 * HECATE Webapp — Built-in Wordlists
 * Compact, operator-usable lists for common webapp attack patterns.
 * Operators can extend via external wordlist files (one entry per line).
 *
 * Sources: curated from SecLists, dirb, common knowledge.
 * Not exhaustive — use full SecLists for production engagements.
 */

const DIRS = [
  // Admin interfaces
  'admin', 'administrator', 'admin/login', 'admin/dashboard',
  'wp-admin', 'wp-login.php', 'wp-config.php',
  'phpmyadmin', 'pma', 'adminer.php', 'adminer',
  'manager', 'console', 'control', 'controlpanel', 'cpanel',
  'panel', 'portal', 'dashboard', 'backend', 'backoffice',

  // Auth endpoints
  'login', 'signin', 'sign-in', 'signup', 'register', 'auth',
  'oauth', 'sso', 'saml', 'logout', 'logoff', 'session',

  // API paths
  'api', 'api/v1', 'api/v2', 'api/v3', 'rest', 'graphql',
  'swagger', 'swagger-ui', 'swagger-ui.html', 'swagger.json',
  'openapi', 'openapi.json', 'api-docs', 'api/swagger.json',

  // Version control / source exposure
  '.git', '.git/config', '.git/HEAD', '.gitignore',
  '.svn', '.hg', '.bzr',

  // Config / secret files
  '.env', '.env.local', '.env.production', '.env.backup',
  'config', 'config.php', 'config.json', 'config.yml', 'config.yaml',
  'settings.py', 'settings.php', 'application.properties',
  'web.config', 'app.config', 'database.yml',

  // Backup / old files
  'backup', 'bak', 'old', 'archive', 'backup.zip', 'backup.tar.gz',
  'db.sql', 'dump.sql', 'database.sql',

  // Debug / dev endpoints
  'debug', 'trace', 'status', 'health', 'healthz', 'ping', 'test',
  'phpinfo.php', 'info.php', 'server-status', 'server-info',

  // Framework-specific
  'vendor', 'node_modules', 'bower_components', 'packages',
  'laravel', 'symfony', 'rails', 'django',
  'actuator', 'actuator/health', 'actuator/env', 'actuator/beans',
  'metrics', 'prometheus', 'jolokia',

  // Common files
  'robots.txt', 'sitemap.xml', 'crossdomain.xml', 'security.txt',
  '.well-known/security.txt', '.well-known/openid-configuration',
  'humans.txt', 'CHANGELOG', 'README', 'LICENSE',

  // Upload / file management
  'upload', 'uploads', 'files', 'file', 'media', 'attachments',
  'documents', 'downloads', 'static', 'assets',

  // Monitoring / logs
  'logs', 'log', 'error_log', 'access_log', 'debug.log',
  'application.log', 'server.log',
];

const PARAMS = [
  // Common injection points
  'id', 'user', 'username', 'name', 'email', 'page', 'file',
  'path', 'dir', 'url', 'redirect', 'next', 'return', 'redir',
  'target', 'dest', 'destination', 'src', 'source',
  'q', 'query', 'search', 'keyword', 'term',
  'lang', 'locale', 'language', 'country', 'region',
  'format', 'type', 'mode', 'action', 'cmd', 'command',
  'exec', 'execute', 'run', 'code', 'eval',
  'include', 'require', 'template', 'view', 'layout',
  'token', 'key', 'api_key', 'secret', 'password', 'pass',
  'callback', 'jsonp', 'ref', 'referrer', 'from', 'to',
  'offset', 'limit', 'count', 'size', 'start', 'end',
  'sort', 'order', 'by', 'filter', 'where', 'group',
];

const EXTENSIONS = [
  // Source / config exposure
  '.php', '.php.bak', '.php~', '.php.old',
  '.asp', '.aspx', '.jsp', '.jspx',
  '.py', '.rb', '.pl', '.sh',
  '.bak', '.backup', '.old', '.orig', '.copy', '.tmp',
  '.sql', '.db', '.sqlite', '.sqlite3',
  '.conf', '.cfg', '.config', '.ini',
  '.log', '.logs',
  '.zip', '.tar', '.tar.gz', '.tgz', '.gz',
  '.yml', '.yaml', '.json', '.xml', '.env',
  '.swp',      // vim swap files
  '~',         // editor backup
  '.DS_Store', // macOS metadata
];

const SUBDOMAINS = [
  'www', 'mail', 'email', 'smtp', 'pop', 'imap', 'webmail',
  'admin', 'administrator', 'api', 'rest', 'graphql',
  'app', 'apps', 'application', 'portal', 'dashboard',
  'dev', 'development', 'staging', 'stage', 'uat', 'test', 'qa',
  'prod', 'production', 'pre-prod', 'preprod',
  'secure', 'security', 'auth', 'sso', 'login', 'accounts',
  'cdn', 'static', 'assets', 'media', 'img', 'images',
  'upload', 'uploads', 'files', 'file', 'download', 'downloads',
  'vpn', 'remote', 'access', 'extranet', 'intranet',
  'ftp', 'sftp', 'ssh', 'git', 'svn', 'hg',
  'monitor', 'monitoring', 'status', 'health',
  'analytics', 'metrics', 'grafana', 'kibana',
  'jira', 'confluence', 'wiki', 'docs', 'support', 'help',
  'blog', 'news', 'shop', 'store', 'payments', 'pay',
  'old', 'legacy', 'v1', 'v2', 'beta', 'alpha',
  'internal', 'private', 'hidden', 'secret',
  'backup', 'bak', 'archive',
  'db', 'database', 'mysql', 'postgres', 'redis', 'mongo',
];

// Interesting file patterns to check on every target
const INTERESTING_FILES = [
  '.env', '.git/config', '.git/HEAD', 'wp-config.php',
  'config.php', 'configuration.php', 'settings.py',
  'web.config', 'robots.txt', 'sitemap.xml',
  'phpinfo.php', 'server-status', 'actuator/env',
];

/**
 * Load a wordlist from a file (one entry per line).
 * Falls back to empty array if file missing.
 */
function loadFile(filePath) {
  const fs = require('fs');
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Combine built-in list with optional external file.
 */
function get(type, externalPath) {
  const builtIn = { dirs: DIRS, params: PARAMS, extensions: EXTENSIONS, subdomains: SUBDOMAINS }[type] ?? [];
  const external = externalPath ? loadFile(externalPath) : [];
  return [...new Set([...builtIn, ...external])];
}

module.exports = { DIRS, PARAMS, EXTENSIONS, SUBDOMAINS, INTERESTING_FILES, get, loadFile };
