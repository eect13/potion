/** Short-lived media tickets. A <video> tag cannot send Authorization, and the
 *  session bearer must not sit in the URL. The ticket is not the session.
 */

type Ticket = { userId: string; exp: number };
const tickets = new Map<string, Ticket>();
const LIFE = 15 * 60 * 1000;

export function issueTicket(userId: string) {
  const now = Date.now();
  for (const [id, t] of tickets) {
    if (t.exp < now) tickets.delete(id);
  }
  const id = crypto.randomUUID().replace(/-/g, "");
  tickets.set(id, { userId, exp: now + LIFE });
  return id;
}

export function userForTicket(id: string) {
  const t = tickets.get(id);
  if (!t) return null;
  if (t.exp < Date.now()) {
    tickets.delete(id);
    return null;
  }
  return t.userId;
}
