import { Bot, Factory, Megaphone, BookUser, Landmark, Signature, SquareKanban, Calendar, FileText, HardDrive, Mail, MessageSquare, Presentation, Receipt, Table, Users, Video, type LucideIcon } from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  mail: Mail, calendar: Calendar, meet: Video, chat: MessageSquare, docs: FileText,
  sheets: Table, slides: Presentation, drive: HardDrive, crm: Users, accounting: Receipt,
  contacts: BookUser, linkedin: Megaphone, projects: SquareKanban, sign: Signature, tax: Landmark, agents: Bot, factories: Factory,
};

export function AppIcon({ id, size = 16 }: { id: string; size?: number }) {
  const Icon = ICONS[id] ?? FileText;
  return <Icon size={size} />;
}
