export type ImportantMail = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  /** Opens the thread in Gmail. */
  url: string;
};

export type ImportantMailResult =
  | { state: 'disconnected' }
  | { state: 'reconnect'; email: string }
  | { state: 'ok'; email: string; messages: ImportantMail[] };
