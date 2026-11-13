import { getCourses, getHoles, getZonesForCourse, getCourseHazards, restoreCourseData } from '../lib/api';
import { SUPABASE_URL, SUPABASE_KEY } from '../config/supabase';

function generateCode(): string {
  return Math.floor(Math.random() * 0xFFFFFFFF)
    .toString(16).padStart(8, '0').toUpperCase();
}

export function formatCode(raw: string): string {
  const c = raw.replace(/[^A-Fa-f0-9]/g, '').toUpperCase().slice(0, 8);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function normalizeCode(input: string): string {
  return input.replace(/[^A-Fa-f0-9]/g, '').toUpperCase().slice(0, 8);
}

const HDR = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

export interface SearchResult {
  id: string;
  share_code: string;
  name: string;
  city: string;
  holes_count: number;
  created_at: string;
}

export async function uploadCourse(courseId: string): Promise<string> {
  const courses = await getCourses();
  const course = courses.find(c => c.id === courseId);
  if (!course) throw new Error('Campo no encontrado');

  const zones = await getZonesForCourse(courseId);
  const holes = (await getHoles(courseId)).map((h: any) => ({
    ...h,
    zones: zones.filter(z => z.holeId === h.id),
  }));

  const code = generateCode();
  const body = {
    share_code: code,
    name: course.name,
    city: course.city ?? '',
    holes_count: holes.length,
    data: { ...course, holes, hazards: await getCourseHazards(courseId) },
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/course_maps`, {
    method: 'POST',
    headers: { ...HDR, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Error subiendo (${resp.status})${txt ? ': ' + txt.slice(0, 120) : ''}`);
  }
  return code;
}

export async function searchByName(query: string): Promise<SearchResult[]> {
  if (query.trim().length < 2) return [];
  const q = encodeURIComponent(`*${query.trim()}*`);
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/course_maps` +
    `?name=ilike.${q}&select=id,share_code,name,city,holes_count,created_at&order=name&limit=20`,
    { headers: HDR },
  );
  if (!resp.ok) throw new Error(`Error buscando (${resp.status})`);
  return resp.json();
}

// Browse every course already shared on the server — no code or exact name
// needed. This is the primary path now: "the server already has it, just
// request it" instead of making every user re-discover/upload the same
// courses their own club already shared.
export async function listPublicCourses(limit = 100): Promise<SearchResult[]> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/course_maps` +
    `?select=id,share_code,name,city,holes_count,created_at&order=name&limit=${limit}`,
    { headers: HDR },
  );
  if (!resp.ok) throw new Error(`Error cargando campos (${resp.status})`);
  return resp.json();
}

export async function downloadByCode(code: string): Promise<number> {
  const normalized = normalizeCode(code);
  if (normalized.length < 6) throw new Error('Código inválido (mínimo 6 caracteres)');

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/course_maps?share_code=eq.${normalized}&select=data`,
    { headers: HDR },
  );
  if (!resp.ok) throw new Error(`Error descargando (${resp.status})`);
  const rows: { data: any }[] = await resp.json();
  if (!rows?.length) throw new Error('Código no encontrado');
  return restoreCourseData(rows[0].data);
}

export async function downloadById(id: string): Promise<number> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/course_maps?id=eq.${id}&select=data`,
    { headers: HDR },
  );
  if (!resp.ok) throw new Error(`Error descargando (${resp.status})`);
  const rows: { data: any }[] = await resp.json();
  if (!rows?.length) throw new Error('Campo no encontrado');
  return restoreCourseData(rows[0].data);
}
