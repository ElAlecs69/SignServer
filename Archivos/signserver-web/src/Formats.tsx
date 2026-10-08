import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

type FormatTemplate = { fileName: string; title: string }
type FormFieldKey = 'evaluator' | 'student' | 'project' | 'grade' | 'observations' | 'date'
type CommitteeRole = 'director' | 'co-director' | 'tutor' | 'external' | 'synod'
type FormValues = Record<FormFieldKey, string> & {
  role: CommitteeRole | ''
  rubricGrades: Record<string, string>
}
type DatePart = 'day' | 'month' | 'year'
type FieldDefinition = {
  key: FormFieldKey
  label: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  multiline?: boolean
}
type GradeDefinition = {
  id: string
  label: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
}
type DateSegmentDefinition = {
  part: DatePart
  pageIndex: number
  x: number
  y: number
  width: number
}
type HtmlDateSegment = Omit<DateSegmentDefinition, 'pageIndex'>
type HtmlChoicePosition = { value: string; label: string; x: number; y: number; width: number }
type HtmlFieldDefinition = {
  id: string
  label: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  multiline?: boolean
  cover?: boolean
  dateSegments?: HtmlDateSegment[]
  choices?: HtmlChoicePosition[]
}
type DocumentAiBounds = { x: number; y: number; width: number; height: number }
type DocumentAiTableCell = {
  rowIndex: number
  columnIndex: number
  text: string
  bounds: DocumentAiBounds | null
}
type DocumentAiTable = {
  pageIndex: number
  rowCount: number
  columnCount: number
  cells: DocumentAiTableCell[]
}
type DocumentAiWord = { text: string; bounds: DocumentAiBounds | null }
type DocumentAiDateGroup = {
  pageIndex: number
  centerX: number
  segments: DateSegmentDefinition[]
}
type DocumentAiLayout = {
  pages: Array<{
    pageIndex: number
    width: number
    height: number
    lines: Array<{ text: string; bounds: DocumentAiBounds | null }>
    words: DocumentAiWord[]
  }>
  tables: DocumentAiTable[]
}
type HtmlFieldInput =
  | { type: 'date' }
  | { type: 'email' }
  | { type: 'digits' }
  | { type: 'number'; min: number; max?: number; step: number }
  | { type: 'select'; options: Array<{ value: string; label: string }> }
  | { type: 'text' }
type HtmlFieldProfile = Omit<HtmlFieldDefinition, 'x' | 'y' | 'width'> & {
  x?: number
  y?: number
  width?: number
  anchor?: RegExp
  maxWidth?: number
}
type RoleMark = {
  role: CommitteeRole
  pageIndex: number
  x: number
  y: number
  hitX: number
  hitY: number
  hitWidth: number
  hitHeight: number
}
type SignatureTarget = { pageIndex: number; x: number; y: number; width: number; maxHeight?: number }
type SignatureSize = { width: number; height: number }
type FormLayout = {
  fields: FieldDefinition[]
  gradeFields: GradeDefinition[]
  dateSegments: DateSegmentDefinition[]
  roles: RoleMark[]
  signature: SignatureTarget
  availableRoles: CommitteeRole[]
}
type FormatResult = {
  file: File
  originalSha256: string
  signedSha256: string
}

const FORMAT_TEMPLATES: FormatTemplate[] = [
  { fileName: 'Evaluacion_1semestre_comite_tutores_P2022.pdf', title: 'Evaluación 1er semestre — Comité de tutores' },
  { fileName: 'Evaluacion_2semestre_comite_tutores_P2022.pdf', title: 'Evaluación 2do semestre — Comité de tutores' },
  { fileName: 'Evaluacion_3semestre_comite_tutores_P2022.pdf', title: 'Evaluación 3er semestre — Comité de tutores' },
  { fileName: 'Evaluacion_4semestre_comite_tutores_P2022.pdf', title: 'Evaluación 4to semestre — Comité de tutores' },
  { fileName: 'Evaluacion_5semestre_comite_tutores_P2022.pdf', title: 'Evaluación 5to semestre — Comité de tutores' },
  { fileName: 'Evaluacion_6semestre_comite_tutores_P2022.pdf', title: 'Evaluación 6to semestre — Comité de tutores' },
  { fileName: 'Evaluacion_Desempeno_CONACYT_.pdf', title: 'Evaluación de desempeño CONACYT' },
  { fileName: 'Evaluacion_Predoctoral.pdf', title: 'Evaluación predoctoral' },
  { fileName: 'Evaluacion_SuficienciaInvestigacion.pdf', title: 'Evaluación de suficiencia de investigación' },
  { fileName: 'formato Componentes en inglés.pdf', title: 'Formato de componentes en inglés' },
  { fileName: 'formato solicitud registro protocolo tesis 2025 Orientacion Investigacion Doctorado.pdf', title: 'Solicitud de registro de protocolo de tesis 2025' },
  { fileName: 'Formato Solocitud Registro Protocolo.pdf', title: 'Solicitud de registro de protocolo' },
  { fileName: 'Formato_EvalProtocolo_P2022.pdf', title: 'Evaluación de protocolo P2022' },
  { fileName: 'Formato_EvaluacionPredoctoral.pdf', title: 'Formato de evaluación predoctoral' },
  { fileName: 'INFORME DE ACTIVIDADES.pdf', title: 'Informe de actividades' },
  { fileName: 'PLAN DE TRABAJO.pdf', title: 'Plan de trabajo' },
  { fileName: 'RevisorDeProtocolo.pdf', title: 'Revisor de protocolo' },
  { fileName: 'RUBRICA EVAL PROTOCOLO.pdf', title: 'Rúbrica de evaluación de protocolo' },
]

const READ_ONLY_FORMATS = new Set([
  'RevisorDeProtocolo.pdf',
  'RUBRICA EVAL PROTOCOLO.pdf',
])

const FIELD_PROFILES: Record<string, HtmlFieldProfile[]> = {
  'Evaluacion_Desempeno_CONACYT_.pdf': [
    { id: 'becario-paterno', label: 'Apellido paterno del becario', pageIndex: 0, x: 64, y: 670, width: 90, height: 17 },
    { id: 'becario-materno', label: 'Apellido materno del becario', pageIndex: 0, x: 163, y: 670, width: 100, height: 17 },
    { id: 'becario-nombres', label: 'Nombre(s) del becario', pageIndex: 0, x: 276, y: 670, width: 125, height: 17 },
    { id: 'asesor', label: 'Nombre del asesor', pageIndex: 0, anchor: /Nombre del Asesor/i, maxWidth: 390, height: 17 },
    { id: 'tesis', label: 'Nombre de la tesis', pageIndex: 0, anchor: /Nombre de la tesis/i, maxWidth: 390, height: 17 },
    {
      id: 'periodo-inicio',
      label: 'Inicio del periodo académico (dd/mm/aa)',
      pageIndex: 0,
      x: 248,
      y: 589.9,
      width: 75,
      height: 17,
      dateSegments: [
        { part: 'day', x: 248, y: 589.9, width: 17 },
        { part: 'month', x: 270, y: 589.9, width: 20 },
        { part: 'year', x: 292, y: 589.9, width: 28 },
      ],
    },
    {
      id: 'periodo-fin',
      label: 'Fin del periodo académico (dd/mm/aa)',
      pageIndex: 0,
      x: 407,
      y: 589.9,
      width: 75,
      height: 17,
      dateSegments: [
        { part: 'day', x: 407, y: 589.9, width: 17 },
        { part: 'month', x: 432, y: 589.9, width: 22 },
        { part: 'year', x: 459, y: 589.9, width: 27 },
      ],
    },
    {
      id: 'activity-performance',
      label: 'Desempeño académico',
      pageIndex: 0,
      x: 238.08,
      y: 494.4,
      width: 75.6,
      height: 17,
      choices: [
        { value: 'excellent', label: 'Excelente / completamente seguro', x: 238.08, y: 494.4, width: 75.6 },
        { value: 'good', label: 'Bueno / seguro', x: 316.56, y: 494.4, width: 74.64 },
        { value: 'sufficient', label: 'Suficiente / casi seguro', x: 394.32, y: 494.4, width: 67.68 },
        { value: 'unsatisfactory', label: 'No satisfactorio / no es seguro', x: 465.12, y: 494.4, width: 74.16 },
      ],
    },
    {
      id: 'activity-study-plan',
      label: 'Cumplimiento del plan de estudios',
      pageIndex: 0,
      x: 238.08,
      y: 463.56,
      width: 75.6,
      height: 17,
      choices: [
        { value: 'excellent', label: 'Excelente / completamente seguro', x: 238.08, y: 463.56, width: 75.6 },
        { value: 'good', label: 'Bueno / seguro', x: 316.56, y: 463.56, width: 74.64 },
        { value: 'sufficient', label: 'Suficiente / casi seguro', x: 394.32, y: 463.56, width: 67.68 },
        { value: 'unsatisfactory', label: 'No satisfactorio / no es seguro', x: 465.12, y: 463.56, width: 74.16 },
      ],
    },
    {
      id: 'activity-degree-timing',
      label: 'Obtención del grado dentro del tiempo oficial del plan de estudios',
      pageIndex: 0,
      x: 238.08,
      y: 432.72,
      width: 75.6,
      height: 17,
      choices: [
        { value: 'excellent', label: 'Excelente / completamente seguro', x: 238.08, y: 432.72, width: 75.6 },
        { value: 'good', label: 'Bueno / seguro', x: 316.56, y: 432.72, width: 74.64 },
        { value: 'sufficient', label: 'Suficiente / casi seguro', x: 394.32, y: 432.72, width: 67.68 },
        { value: 'unsatisfactory', label: 'No satisfactorio / no es seguro', x: 465.12, y: 432.72, width: 74.16 },
      ],
    },
    { id: 'comentarios', label: 'Comentarios sobre la evaluación', pageIndex: 0, x: 64, y: 315, width: 468, height: 74, multiline: true },
    { id: 'avance', label: 'Porcentaje de avance de la tesis', pageIndex: 0, x: 285, y: 292, width: 65, height: 17 },
    {
      id: 'fecha-evaluacion',
      label: 'Fecha de evaluación',
      pageIndex: 0,
      x: 168,
      y: 117.6,
      width: 91,
      height: 17,
      dateSegments: [
        { part: 'day', x: 168, y: 117.6, width: 22 },
        { part: 'month', x: 197, y: 117.6, width: 28 },
        { part: 'year', x: 229, y: 117.6, width: 32 },
      ],
    },
  ],
  'formato Componentes en inglés.pdf': [
    { id: 'learning-unit', label: 'Learning unit', pageIndex: 0, x: 150, y: 436.8, width: 172, height: 17 },
    { id: 'professor', label: 'Professor', pageIndex: 0, anchor: /Professor:/i, maxWidth: 300, height: 17 },
    { id: 'degree-program', label: 'Degree program', pageIndex: 0, x: 165, y: 422.16, width: 205, height: 17 },
    { id: 'term', label: 'Term', pageIndex: 0, anchor: /Term:/i, maxWidth: 80, height: 17 },
    { id: 'date', label: 'Date', pageIndex: 0, anchor: /Date:/i, maxWidth: 100, height: 17 },
    { id: 'activities', label: 'Activities', pageIndex: 0, x: 70, y: 158, width: 160, height: 232, multiline: true },
    { id: 'resources', label: 'Resources', pageIndex: 0, x: 235, y: 158, width: 180, height: 232, multiline: true },
    { id: 'evidence', label: 'Evidence', pageIndex: 0, x: 420, y: 158, width: 300, height: 232, multiline: true },
  ],
  'formato solicitud registro protocolo tesis 2025 Orientacion Investigacion Doctorado.pdf': [
    { id: 'dea', label: 'Registro D.E.A.', pageIndex: 0, anchor: /Registro D\.E\.A\./i, maxWidth: 130, height: 17 },
    { id: 'student', label: 'Nombre del alumno', pageIndex: 0, anchor: /Nombre del alumno/i, maxWidth: 420, height: 17 },
    { id: 'entry-date', label: 'Fecha de ingreso', pageIndex: 0, anchor: /Fecha de ingreso/i, maxWidth: 115, height: 17 },
    { id: 'study-duration', label: 'Duración del plan de estudios en años', pageIndex: 0, anchor: /Duración del Plan de estudios/i, maxWidth: 70, height: 17 },
    { id: 'email', label: 'Email', pageIndex: 0, anchor: /Email/i, maxWidth: 450, height: 17 },
    { id: 'program', label: 'Nombre del programa académico', pageIndex: 0, anchor: /Nombre del programa académico/i, maxWidth: 380, height: 17 },
    { id: 'keywords', label: 'Palabras clave de la investigación', pageIndex: 0, anchor: /Palabras clave de la investigación/i, maxWidth: 340, height: 17 },
    { id: 'director', label: 'Nombre del director', pageIndex: 0, x: 125, y: 312, width: 115, height: 17 },
    { id: 'co-director', label: 'Nombre del codirector', pageIndex: 0, x: 125, y: 271, width: 115, height: 17 },
    { id: 'tutor', label: 'Nombre del tutor', pageIndex: 0, x: 125, y: 230, width: 115, height: 17 },
    { id: 'research-registration', label: 'Número de registro del proyecto de investigación', pageIndex: 0, anchor: /Número de registro del proyecto de investigación/i, maxWidth: 540, height: 17 },
    { id: 'funding-other', label: 'Otro financiamiento', pageIndex: 0, x: 250, y: 145, width: 180, height: 17 },
    { id: 'products', label: 'Tres principales productos académicos del comité tutorial', pageIndex: 1, x: 60, y: 390, width: 490, height: 190, multiline: true },
    { id: 'student-signature-name', label: 'Nombre del alumno', pageIndex: 1, x: 88, y: 357, width: 110, height: 17 },
    { id: 'tutor-signature-name', label: 'Nombre del tutor académico', pageIndex: 1, x: 322, y: 357, width: 190, height: 17 },
    { id: 'coordinator-name', label: 'Nombre del coordinador del programa', pageIndex: 1, x: 205, y: 248, width: 230, height: 17 },
    { id: 'schedule', label: 'Cronograma de actividades', pageIndex: 2, x: 55, y: 185, width: 500, height: 415, multiline: true },
  ],
  'Formato Solocitud Registro Protocolo.pdf': [
    { id: 'dea', label: 'Registro D.E.A.', pageIndex: 0, anchor: /Registro D\.E\.A\./i, maxWidth: 130, height: 17 },
    { id: 'student', label: 'Nombre del alumno', pageIndex: 0, anchor: /Nombre del alumno/i, maxWidth: 420, height: 17 },
    { id: 'entry-date', label: 'Fecha de ingreso', pageIndex: 0, anchor: /Fecha de ingreso/i, maxWidth: 115, height: 17 },
    { id: 'study-duration', label: 'Duración del plan de estudios en años', pageIndex: 0, anchor: /Duración del Plan de estudios/i, maxWidth: 70, height: 17 },
    { id: 'email', label: 'Email', pageIndex: 0, anchor: /Email/i, maxWidth: 450, height: 17 },
    { id: 'program', label: 'Nombre del programa académico', pageIndex: 0, anchor: /Nombre del programa académico/i, maxWidth: 380, height: 17 },
    { id: 'thesis-title', label: 'Título de la tesis', pageIndex: 0, x: 150, y: 400, width: 400, height: 17 },
    { id: 'keywords', label: 'Palabras clave de la tesis', pageIndex: 0, x: 230, y: 374, width: 320, height: 17 },
    { id: 'director', label: 'Nombre del director', pageIndex: 0, x: 150, y: 319, width: 115, height: 17 },
    { id: 'co-director', label: 'Nombre del codirector', pageIndex: 0, x: 150, y: 278, width: 115, height: 17 },
    { id: 'tutor', label: 'Nombre del tutor', pageIndex: 0, x: 150, y: 237, width: 115, height: 17 },
    { id: 'research-registration', label: 'Número de registro del proyecto de investigación', pageIndex: 0, anchor: /Número de registro del proyecto de investigación/i, maxWidth: 540, height: 17 },
    { id: 'funding-other', label: 'Otro financiamiento', pageIndex: 0, x: 250, y: 152, width: 180, height: 17 },
    { id: 'products', label: 'Tres principales productos académicos del comité tutorial', pageIndex: 1, x: 65, y: 405, width: 485, height: 185, multiline: true },
    { id: 'student-signature-name', label: 'Nombre del alumno', pageIndex: 1, x: 70, y: 295, width: 110, height: 17 },
    { id: 'director-signature-name', label: 'Nombre del director de tesis', pageIndex: 1, x: 320, y: 295, width: 190, height: 17 },
    { id: 'coordinator-name', label: 'Nombre del coordinador del programa', pageIndex: 1, x: 180, y: 119, width: 230, height: 17 },
    { id: 'schedule', label: 'Cronograma de actividades', pageIndex: 2, x: 65, y: 140, width: 490, height: 420, multiline: true },
  ],
  'Formato_EvalProtocolo_P2022.pdf': [
    { id: 'evaluation-date', label: 'Fecha de evaluación', pageIndex: 0, x: 315, y: 641, width: 160, height: 17, cover: true },
    { id: 'student', label: 'Nombre del alumno o alumna', pageIndex: 0, anchor: /Nombre del Alumno\/Alumna/i, maxWidth: 400, height: 17 },
    { id: 'project', label: 'Título del proyecto', pageIndex: 0, anchor: /Título del Proyecto/i, maxWidth: 430, height: 17 },
    { id: 'grade-antecedents', label: 'Calificación de antecedentes', pageIndex: 0, x: 510, y: 515, width: 35, height: 17 },
    { id: 'grade-objectives', label: 'Calificación de objetivos', pageIndex: 0, x: 510, y: 386, width: 35, height: 17 },
    { id: 'grade-hypothesis', label: 'Calificación de hipótesis', pageIndex: 0, x: 510, y: 358, width: 35, height: 17 },
    { id: 'grade-methodology', label: 'Calificación de metodología', pageIndex: 0, x: 510, y: 344, width: 35, height: 17 },
    { id: 'grade-schedule', label: 'Calificación de cronograma', pageIndex: 0, x: 510, y: 330, width: 35, height: 17 },
    { id: 'observations', label: 'Observaciones', pageIndex: 0, x: 95, y: 150, width: 450, height: 70, multiline: true },
    { id: 'reviewer-name', label: 'Nombre del tutor o tutora', pageIndex: 1, x: 225, y: 610, width: 180, height: 17 },
    { id: 'reviewer-signature', label: 'Firma del tutor o tutora', pageIndex: 1, x: 420, y: 610, width: 115, height: 17 },
  ],
  'INFORME DE ACTIVIDADES.pdf': [
    { id: 'coordinator', label: 'Nombre del coordinador o coordinadora', pageIndex: 0, x: 92, y: 657, width: 300, height: 16, cover: true },
    { id: 'semester', label: 'Semestre del informe', pageIndex: 0, x: 430, y: 583, width: 105, height: 16, cover: true },
    { id: 'student-name', label: 'Nombre del alumno o alumna', pageIndex: 0, x: 157, y: 564, width: 220, height: 16, cover: true },
    { id: 'cvu', label: 'Número de CVU CONACyT', pageIndex: 0, x: 350, y: 564, width: 65, height: 16, cover: true },
    { id: 'lgac', label: 'Línea de generación y aplicación del conocimiento', pageIndex: 0, x: 300, y: 553, width: 180, height: 16, cover: true },
    { id: 'period', label: 'Periodo de actividades', pageIndex: 0, x: 220, y: 542, width: 230, height: 16, cover: true },
    { id: 'grades', label: 'Unidades de aprendizaje y calificaciones', pageIndex: 0, x: 95, y: 475, width: 450, height: 55, multiline: true },
    { id: 'research-advance', label: 'Avance del proyecto de investigación y tesis', pageIndex: 0, x: 95, y: 315, width: 450, height: 100, multiline: true },
    { id: 'comments', label: 'Comentarios del comité de tutores', pageIndex: 1, x: 95, y: 335, width: 450, height: 95, multiline: true },
    { id: 'review-date', label: 'Fecha de revisión', pageIndex: 1, x: 95, y: 301, width: 350, height: 17 },
  ],
  'PLAN DE TRABAJO.pdf': [
    { id: 'coordinator', label: 'Nombre del coordinador o coordinadora', pageIndex: 0, x: 92, y: 657, width: 300, height: 16, cover: true },
    { id: 'semester', label: 'Semestre del plan', pageIndex: 0, x: 430, y: 593, width: 105, height: 16, cover: true },
    { id: 'student-name', label: 'Nombre del alumno o alumna', pageIndex: 0, x: 208, y: 573, width: 230, height: 16, cover: true },
    { id: 'cvu', label: 'Número de CVU CONACyT', pageIndex: 0, x: 450, y: 573, width: 80, height: 16, cover: true },
    { id: 'lgac', label: 'Línea de generación y aplicación del conocimiento', pageIndex: 0, x: 390, y: 563, width: 135, height: 16, cover: true },
    { id: 'period', label: 'Periodo de actividades', pageIndex: 0, x: 395, y: 552, width: 130, height: 16, cover: true },
    { id: 'weekly-plan', label: 'Actividades semanales', pageIndex: 0, x: 95, y: 390, width: 450, height: 160, multiline: true },
    { id: 'semester-objectives', label: 'Objetivos del semestre', pageIndex: 0, x: 95, y: 105, width: 450, height: 135, multiline: true },
    { id: 'review-date', label: 'Fecha de revisión', pageIndex: 1, x: 95, y: 467, width: 350, height: 17 },
  ],
}

const PDF_FONT_SIZE = 11
const SIGNATURE_WIDTH = 165
const SIGNATURE_MAX_HEIGHT = 28
const SIGNATURE_LABEL_GAP = 7
const FIELD_HEIGHT = 17
const UNDERLINE_TEXT_OFFSET = 3
const DATE_BASELINE_OFFSET = 3
const isDateField = (id: string, label = '') =>
  /(date|fecha|periodo-inicio|periodo-fin)/i.test(id) || /\b(date|fecha)\b/i.test(label)
const EMAIL_PATTERN = /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i

function getHtmlFieldInput(
  field: Pick<HtmlFieldDefinition, 'id' | 'label' | 'multiline' | 'choices'>,
): HtmlFieldInput {
  if (field.choices) {
    return {
      type: 'select',
      options: field.choices.map(({ value, label }) => ({ value, label })),
    }
  }
  const identity = `${field.id} ${field.label}`.toLowerCase()
  if (isDateField(field.id, field.label)) return { type: 'date' }
  if (/\b(email|correo)\b/.test(identity)) return { type: 'email' }
  if (/\bcvu\b/.test(identity)) return { type: 'digits' }
  if (/\b(porcentaje|percent|avance)\b/.test(identity)) {
    return { type: 'number', min: 0, max: 100, step: 0.1 }
  }
  if (/\b(semestre|semester)\b/.test(identity)) {
    return { type: 'number', min: 1, max: 12, step: 1 }
  }
  if (/\b(calificaci[oó]n|grade)\b/.test(identity)) {
    return { type: 'number', min: 0, max: 10, step: 0.1 }
  }
  if (/\b(duraci[oó]n|duration)\b/.test(identity)) {
    return { type: 'number', min: 0.1, step: 0.1 }
  }
  return { type: 'text' }
}

function formatHtmlFieldValue(field: HtmlFieldDefinition, value: string): string {
  if (getHtmlFieldInput(field).type !== 'date' || !value) return value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match || !isValidIsoDate(value)) return value.trim()
  const [, year, month, day] = match
  const displayedYear = /\bdd\s*\/\s*mm\s*\/\s*aa\b/i.test(field.label) ? year.slice(-2) : year
  return `${day}/${month}/${displayedYear}`
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day] = match
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day))
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
}

function validateHtmlField(field: HtmlFieldDefinition, rawValue: string): string | null {
  const value = rawValue.trim()
  const input = getHtmlFieldInput(field)
  if (input.type === 'select' && !input.options.some((option) => option.value === value)) {
    return `Selecciona una opción para ${field.label.toLowerCase()}.`
  }
  if (!value) return null
  if (input.type === 'email' && (value.length > 254 || !EMAIL_PATTERN.test(value))) {
    return `${field.label} debe tener una dirección de correo válida.`
  }
  if (input.type === 'date' && !isValidIsoDate(value)) {
    return `${field.label} debe ser una fecha válida.`
  }
  if (input.type === 'digits' && !/^\d+$/.test(value)) {
    return `${field.label} solo debe contener números.`
  }
  if (input.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number) || number < input.min || (input.max !== undefined && number > input.max)) {
      const range = input.max === undefined ? `mayor o igual a ${input.min}` : `entre ${input.min} y ${input.max}`
      return `${field.label} debe ser ${range}.`
    }
    const steps = (number - input.min) / input.step
    if (Math.abs(steps - Math.round(steps)) > 1e-8) {
      return `${field.label} debe usar incrementos de ${input.step}.`
    }
  }
  return null
}

function buildAiTableFields(layout: DocumentAiLayout): HtmlFieldDefinition[] {
  const fields: HtmlFieldDefinition[] = []
  const headerPatterns = /\b(excelente|bueno|suficiente|satisfactorio|calificaci[oó]n|rating|score|grade|yes|no|s[ií])\b/i

  for (const [tableIndex, table] of layout.tables.entries()) {
    const cells = new Map(table.cells.map((cell) => [`${cell.rowIndex}:${cell.columnIndex}`, cell]))
    const headerRow = Math.min(...table.cells.map((cell) => cell.rowIndex))
    const headers = Array.from({ length: table.columnCount }, (_, columnIndex) =>
      cells.get(`${headerRow}:${columnIndex}`)?.text.trim() ?? '',
    )
    const choiceColumns = headers
      .map((label, columnIndex) => ({ label, columnIndex }))
      .filter(({ label, columnIndex }) => columnIndex > 0 && label && headerPatterns.test(label))
    const isChoiceGrid = choiceColumns.length >= 2

    for (let rowIndex = headerRow + 1; rowIndex < table.rowCount; rowIndex += 1) {
      const rowLabel = cells.get(`${rowIndex}:0`)?.text.trim()
      if (!rowLabel) continue
      if (isChoiceGrid) {
        const choices = choiceColumns.flatMap(({ label, columnIndex }) => {
          const cell = cells.get(`${rowIndex}:${columnIndex}`)
          if (!cell?.bounds) return []
          return [{
            value: `column-${columnIndex}`,
            label,
            x: cell.bounds.x,
            y: cell.bounds.y + (cell.bounds.height - PDF_FONT_SIZE) / 2,
            width: cell.bounds.width,
          }]
        })
        if (choices.length < 2) continue
        fields.push({
          id: `ai-table-${table.pageIndex}-${tableIndex}-row-${rowIndex}`,
          label: rowLabel,
          pageIndex: table.pageIndex,
          x: choices[0].x,
          y: choices[0].y,
          width: choices.reduce((sum, choice) => sum + choice.width, 0),
          height: Math.max(...choices.map((choice) => cells.get(`${rowIndex}:${choice.value.replace('column-', '')}`)?.bounds?.height ?? FIELD_HEIGHT)),
          choices,
        })
        continue
      }

      for (let columnIndex = 1; columnIndex < table.columnCount; columnIndex += 1) {
        const cell = cells.get(`${rowIndex}:${columnIndex}`)
        if (!cell?.bounds || cell.text.trim()) continue
        const header = headers[columnIndex] || `columna ${columnIndex + 1}`
        fields.push({
          id: `ai-table-${table.pageIndex}-${tableIndex}-cell-${rowIndex}-${columnIndex}`,
          label: `${rowLabel} — ${header}`,
          pageIndex: table.pageIndex,
          x: cell.bounds.x,
          y: cell.bounds.y + 2,
          width: cell.bounds.width,
          height: cell.bounds.height,
        })
      }
    }
  }
  return fields
}

function buildAiDateGroups(layout: DocumentAiLayout): DocumentAiDateGroup[] {
  const groups: DocumentAiDateGroup[] = []
  const markerType = (text: string): DatePart | null => {
    const normalized = text.toLowerCase().replace(/[^a-záéíóú]/g, '')
    if (/^(d{1,2}|day)$/.test(normalized)) return 'day'
    if (/^(m{1,2}|month)$/.test(normalized)) return 'month'
    if (/^(a{2,4}|y{2,4}|year)$/.test(normalized)) return 'year'
    return null
  }

  for (const page of layout.pages) {
    const rows: DocumentAiWord[][] = []
    for (const word of page.words.filter((item) => item.bounds).sort((a, b) =>
      (b.bounds?.y ?? 0) - (a.bounds?.y ?? 0) || (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0),
    )) {
      const row = rows.find((items) => Math.abs((items[0].bounds?.y ?? 0) - (word.bounds?.y ?? 0)) <= 3)
      if (row) row.push(word)
      else rows.push([word])
    }

    for (const row of rows) {
      const markers = row.flatMap((word) => {
        const part = markerType(word.text)
        return part && word.bounds ? [{ part, bounds: word.bounds }] : []
      }).sort((a, b) => a.bounds.x - b.bounds.x)
      const compactMarkers = markers.reduce<typeof markers>((result, marker) => {
        const previous = result[result.length - 1]
        if (previous?.part === marker.part && marker.bounds.x - (previous.bounds.x + previous.bounds.width) < 10) {
          const right = Math.max(previous.bounds.x + previous.bounds.width, marker.bounds.x + marker.bounds.width)
          const bottom = Math.min(previous.bounds.y, marker.bounds.y)
          const top = Math.max(
            previous.bounds.y + previous.bounds.height,
            marker.bounds.y + marker.bounds.height,
          )
          previous.bounds = {
            x: previous.bounds.x,
            y: bottom,
            width: right - previous.bounds.x,
            height: top - bottom,
          }
        } else {
          result.push({ ...marker, bounds: { ...marker.bounds } })
        }
        return result
      }, [])
      let index = 0
      while (index + 2 < compactMarkers.length) {
        const day = compactMarkers[index]
        const month = compactMarkers[index + 1]
        const year = compactMarkers[index + 2]
        if (day.part !== 'day' || month.part !== 'month' || year.part !== 'year') {
          index += 1
          continue
        }
        const centerX = (day.bounds.x + year.bounds.x + year.bounds.width) / 2
        const nearbyDateLabel = page.lines.some((line) =>
          /\b(fecha|date|periodo|period)\b/i.test(line.text)
          && line.bounds
          && Math.abs(line.bounds.y - day.bounds.y) <= 65,
        )
        if (nearbyDateLabel) {
          groups.push({
            pageIndex: page.pageIndex,
            centerX,
            segments: [
              { part: 'day', pageIndex: page.pageIndex, x: day.bounds.x - 1, y: day.bounds.y - 1, width: Math.max(14, day.bounds.width + 2) },
              { part: 'month', pageIndex: page.pageIndex, x: month.bounds.x - 1, y: month.bounds.y - 1, width: Math.max(15, month.bounds.width + 2) },
              { part: 'year', pageIndex: page.pageIndex, x: year.bounds.x - 1, y: year.bounds.y - 1, width: Math.max(25, year.bounds.width + 2) },
            ],
          })
        }
        index += 3
      }
    }
  }
  return groups
}

const FOUR_ROLES: CommitteeRole[] = ['director', 'co-director', 'tutor', 'external']
const FIVE_ROLES: CommitteeRole[] = [...FOUR_ROLES, 'synod']
const ROLE_LABELS: Record<CommitteeRole, string> = {
  director: 'Director(a)',
  'co-director': 'Co-director(a)',
  tutor: 'Tutor(a)',
  external: 'Externo(a)',
  synod: 'Sínodo',
}

const basicFields = (
  positions: Record<FormFieldKey, Omit<FieldDefinition, 'key' | 'label'>>,
): FieldDefinition[] => [
  { key: 'evaluator', label: 'Nombre del evaluador', ...positions.evaluator },
  { key: 'student', label: 'Nombre del alumno', ...positions.student },
  { key: 'project', label: 'Título del proyecto', ...positions.project },
  { key: 'grade', label: 'Calificación asignada', ...positions.grade },
  { key: 'observations', label: 'Observaciones', ...positions.observations, multiline: true },
  { key: 'date', label: 'Fecha', ...positions.date },
]

const getFieldDisplayY = (field: Pick<FieldDefinition, 'key' | 'y'>) =>
  field.y + (field.key === 'evaluator' || field.key === 'student' || field.key === 'project'
    ? UNDERLINE_TEXT_OFFSET
    : 0)

const roleMarks = (
  pageIndex: number,
  positions: Array<[CommitteeRole, number, number, number?, number?]>,
): RoleMark[] => positions.map(([role, x, y, hitX = x - 22, hitWidth = 44]) => ({
  role,
  pageIndex,
  x,
  y,
  hitX,
  hitY: y - 9,
  hitWidth,
  hitHeight: 18,
}))

const dateSegments = (
  pageIndex: number,
  y: number,
  positions: Array<[DatePart, number, number]>,
): DateSegmentDefinition[] => positions.map(([part, x, width]) => ({
  part,
  pageIndex,
  x,
  y: y + DATE_BASELINE_OFFSET,
  width,
}))

function getFormLayout(fileName: string): FormLayout | null {
  const semester = Number(fileName.match(/Evaluacion_([1-6])semestre/)?.[1])
  const predoctoral = /^(Evaluacion_Predoctoral|Formato_EvaluacionPredoctoral)\.pdf$/i.test(fileName)
  const sufficiency = /^Evaluacion_SuficienciaInvestigacion\.pdf$/i.test(fileName)

  if (semester === 1) {
    return {
      fields: basicFields({
        evaluator: { pageIndex: 0, x: 212, y: 649, width: 325, height: FIELD_HEIGHT },
        student: { pageIndex: 0, x: 194, y: 586, width: 324, height: FIELD_HEIGHT },
        project: { pageIndex: 0, x: 193, y: 563, width: 324, height: FIELD_HEIGHT },
        grade: { pageIndex: 0, x: 351, y: 288, width: 48, height: FIELD_HEIGHT },
        observations: { pageIndex: 0, x: 95, y: 252, width: 430, height: 65 },
        date: { pageIndex: 0, x: 203, y: 158, width: 135, height: FIELD_HEIGHT },
      }),
      gradeFields: [
        { id: 'report', label: 'Calificación del reporte parcial', pageIndex: 0, x: 426, y: 470, width: 38, height: 17 },
        { id: 'protocol', label: 'Calificación del protocolo de investigación', pageIndex: 0, x: 426, y: 447, width: 38, height: 13 },
        { id: 'progress', label: 'Calificación de avances', pageIndex: 0, x: 426, y: 381, width: 38, height: 17 },
      ],
      dateSegments: dateSegments(0, 156, [
        ['day', 195, 47],
        ['month', 255, 153],
        ['year', 422, 50],
      ]),
      roles: roleMarks(0, [
        ['director', 171, 621, 71, 114],
        ['co-director', 302, 621, 184, 136],
        ['tutor', 399, 621, 319, 92],
        ['external', 508, 621, 410, 113],
      ]),
      signature: { pageIndex: 0, x: 103, y: 104, width: SIGNATURE_WIDTH },
      availableRoles: FOUR_ROLES,
    }
  }

  if (semester === 2) {
    return {
      fields: basicFields({
        evaluator: { pageIndex: 0, x: 291, y: 657, width: 322, height: FIELD_HEIGHT },
        student: { pageIndex: 0, x: 318, y: 602, width: 294, height: FIELD_HEIGHT },
        project: { pageIndex: 0, x: 318, y: 583, width: 294, height: FIELD_HEIGHT },
        grade: { pageIndex: 0, x: 445, y: 175, width: 50, height: FIELD_HEIGHT },
        observations: { pageIndex: 0, x: 230, y: 193, width: 350, height: 18 },
        date: { pageIndex: 0, x: 227, y: 157, width: 125, height: FIELD_HEIGHT },
      }),
      gradeFields: [
        { id: 'written', label: 'Calificación del reporte parcial', pageIndex: 0, x: 390, y: 475, width: 40, height: 17 },
        { id: 'oral', label: 'Calificación de avances y presentación oral', pageIndex: 0, x: 390, y: 347, width: 40, height: 17 },
      ],
      dateSegments: dateSegments(0, 155, [
        ['day', 222, 38],
        ['month', 276, 150],
        ['year', 444, 50],
      ]),
      roles: roleMarks(0, [
        ['director', 198, 620],
        ['co-director', 298, 620],
        ['tutor', 367, 620],
        ['external', 438, 620],
      ]),
      signature: { pageIndex: 0, x: 132, y: 139, width: SIGNATURE_WIDTH },
      availableRoles: FOUR_ROLES,
    }
  }

  if (semester && semester >= 3 && semester <= 6) {
    return {
      fields: basicFields({
        evaluator: { pageIndex: 0, x: 321, y: 508, width: 275, height: FIELD_HEIGHT },
        student: { pageIndex: 0, x: 321, y: 443, width: 275, height: FIELD_HEIGHT },
        project: { pageIndex: 0, x: 321, y: 425, width: 275, height: FIELD_HEIGHT },
        grade: { pageIndex: 1, x: 455, y: 460, width: 50, height: FIELD_HEIGHT },
        observations: { pageIndex: 1, x: 230, y: 478, width: 350, height: 18 },
        date: { pageIndex: 1, x: 180, y: 438, width: 135, height: FIELD_HEIGHT },
      }),
      gradeFields: [
        { id: 'written', label: 'Calificación del reporte parcial', pageIndex: 0, x: 421, y: 313, width: 40, height: 17 },
      ],
      dateSegments: dateSegments(1, 440, [
        ['day', 222, 38],
        ['month', 276, 150],
        ['year', 444, 50],
      ]),
      roles: roleMarks(0, [
        ['director', 230, 473],
        ['co-director', 337, 473],
        ['tutor', 411, 473],
        ['external', 218, 461],
      ]),
      signature: { pageIndex: 1, x: 182, y: 407, width: SIGNATURE_WIDTH },
      availableRoles: FOUR_ROLES,
    }
  }

  if (predoctoral || sufficiency) {
    const top = predoctoral ? 607 : 614
    const roleY = predoctoral ? 572 : 580
    const studentY = predoctoral ? 555 : 562
    const projectY = predoctoral ? 538 : 545
    const rolePositions: Array<[CommitteeRole, number, number, number?, number?]> = [
      ['director', 143, roleY, 108],
      ['co-director', 265, roleY, 219],
      ['tutor', 345, roleY, 310],
      ['external', 441, roleY, 407],
    ]
    if (predoctoral) rolePositions.push(['synod', 496, roleY, 470])

    return {
      fields: basicFields({
        evaluator: { pageIndex: 0, x: 190, y: top, width: 400, height: FIELD_HEIGHT },
        student: { pageIndex: 0, x: 190, y: studentY, width: 400, height: FIELD_HEIGHT },
        project: { pageIndex: 0, x: 190, y: projectY, width: 400, height: FIELD_HEIGHT },
        grade: {
          pageIndex: 0,
          x: predoctoral ? 329 : 329,
          y: predoctoral ? 270 : 280,
          width: 50,
          height: FIELD_HEIGHT,
        },
        observations: {
          pageIndex: 0,
          x: predoctoral ? 77 : 77,
          y: predoctoral ? 238 : 247,
          width: 415,
          height: predoctoral ? 72 : 70,
        },
        date: { pageIndex: 0, x: 249, y: predoctoral ? 139 : 148, width: 135, height: FIELD_HEIGHT },
      }),
      gradeFields: predoctoral
        ? [
            { id: 'written', label: 'Calificación del reporte parcial', pageIndex: 0, x: 425, y: 451, width: 40, height: 17 },
            { id: 'oral', label: 'Calificación de avances y presentación oral', pageIndex: 0, x: 425, y: 360, width: 40, height: 17 },
          ]
        : [
            { id: 'written', label: 'Calificación del reporte final', pageIndex: 0, x: 425, y: 460, width: 40, height: 17 },
            { id: 'oral', label: 'Calificación de investigación y presentación oral', pageIndex: 0, x: 425, y: 370, width: 40, height: 17 },
          ],
      dateSegments: predoctoral
        ? dateSegments(0, 138, [
            ['day', 222, 40],
            ['month', 277, 153],
            ['year', 445, 50],
          ])
        : dateSegments(0, 147, [
            ['day', 222, 40],
            ['month', 277, 153],
            ['year', 445, 50],
          ]),
      roles: roleMarks(0, rolePositions),
      signature: { pageIndex: 0, x: 264, y: predoctoral ? 92 : 90, width: SIGNATURE_WIDTH },
      availableRoles: predoctoral ? FIVE_ROLES : FOUR_ROLES,
    }
  }

  return null
}

async function detectHtmlFields(
  pages: PDFPageProxy[],
  fileName: string,
): Promise<HtmlFieldDefinition[]> {
  const profile = FIELD_PROFILES[fileName]
  if (!profile) return []

  const pageItems = await Promise.all(pages.map(async (page) => {
    const content = await page.getTextContent()
    return content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return []
      return [{
        text: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: Math.max(12, item.height),
      }]
    })
  }))

  return profile.flatMap((field) => {
    if (field.pageIndex >= pages.length) return []
    if (field.x !== undefined && field.y !== undefined) {
      return [{
        id: field.id,
        label: field.label,
        pageIndex: field.pageIndex,
        x: field.x,
        y: field.y + (isDateField(field.id, field.label) ? DATE_BASELINE_OFFSET : 0),
        width: field.width ?? field.maxWidth ?? 0,
        height: field.height,
        multiline: field.multiline,
        cover: field.cover,
        dateSegments: field.dateSegments,
        choices: field.choices,
      }]
    }
    if (!field.anchor) return []

    const items = pageItems[field.pageIndex]
    const lines: typeof items[] = []
    for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      let line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.5)
      if (!line) {
        line = []
        lines.push(line)
      }
      line.push(item)
    }
    const matchedLine = lines.find((line) => {
      const text = line.map((item) => item.text).join(' ').replace(/\s+/g, ' ')
      return field.anchor?.test(text) ?? false
    })
    if (!matchedLine) return []

    matchedLine.sort((a, b) => a.x - b.x)
    const anchorItem = matchedLine.find((item) => field.anchor?.test(item.text))
    const colonIndex = anchorItem
      ? matchedLine.indexOf(anchorItem)
      : matchedLine.findIndex((item) => /[:：]/.test(item.text))
    const labelItem = colonIndex >= 0
      ? matchedLine[colonIndex]
      : [...matchedLine].reverse().find((item) => field.anchor?.test(item.text))
    if (!labelItem) return []

    const colonPosition = labelItem.text.search(/[:：]/)
    const textAfterColon = colonPosition >= 0 ? labelItem.text.slice(colonPosition + 1).trim() : ''
    const blankAfterLabel = colonIndex >= 0
      ? matchedLine.slice(colonIndex + 1).find((item) => /^[_ .-]{3,}$/.test(item.text))
      : undefined
    const inlineBlank = textAfterColon.match(/^[_ .-]{3,}$/)
    const x = blankAfterLabel?.x ?? (
      inlineBlank && colonPosition >= 0
        ? labelItem.x + labelItem.width * (colonPosition + 1) / labelItem.text.length
        : labelItem.x + labelItem.width + 4
    )
    const inlineWidth = inlineBlank && colonPosition >= 0
      ? labelItem.width * textAfterColon.length / labelItem.text.length
      : undefined
    const nextItem = matchedLine.find((item) => item.x > x + 1 && item !== blankAfterLabel)
    const remainingWidth = nextItem
      ? nextItem.x - x - 4
      : pages[field.pageIndex].view[2] - x - 24
    const width = blankAfterLabel
      ? Math.min(blankAfterLabel.width, field.maxWidth ?? blankAfterLabel.width)
      : Math.max(0, Math.min(field.maxWidth ?? remainingWidth, inlineWidth ?? remainingWidth))
    if (width < 36) return []

    return [{
      id: field.id,
      label: field.label,
      pageIndex: field.pageIndex,
      x,
      y: (blankAfterLabel?.y ?? labelItem.y)
        + (isDateField(field.id, field.label) ? DATE_BASELINE_OFFSET : 0),
      width,
      height: field.height,
      multiline: field.multiline,
      cover: field.cover,
      dateSegments: field.dateSegments,
      choices: field.choices,
    }]
  })
}

function getFallbackSignatureTarget(pages: PDFPageProxy[]): SignatureTarget {
  const pageIndex = Math.max(0, pages.length - 1)
  const page = pages[pageIndex]
  const [left, bottom, right] = page.view
  return {
    pageIndex,
    x: left + 48,
    y: bottom + 92,
    width: Math.min(SIGNATURE_WIDTH, (right - left) / 3),
  }
}

async function findSignatureTarget(pages: PDFPageProxy[]): Promise<SignatureTarget | null> {
  const pageText = await Promise.all(pages.map(async (page, pageIndex) => {
    const content = await page.getTextContent()
    const items = content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return []
      return [{
        text: item.str.trim(),
        pageIndex,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
      }]
    })
    return {
      items,
      anchors: items.filter((item) => /\bfirma(?:\s+y\s+nombre)?\b/i.test(item.text)),
      underlines: items.filter((item) => /^_{3,}$/.test(item.text)),
    }
  }))
  const candidates = pageText.flatMap((page) => page.anchors)
  if (!candidates.length) return null

  const lastPageIndex = Math.max(...candidates.map((candidate) => candidate.pageIndex))
  const anchor = candidates
    .filter((candidate) => candidate.pageIndex === lastPageIndex)
    .sort((a, b) => a.y - b.y)[0]
  if (!anchor) return null
  const labelCenter = anchor.x + anchor.width / 2
  const underline = pageText[anchor.pageIndex].underlines
    .filter((line) => {
      const lineCenter = line.x + line.width / 2
      const verticalGap = line.y - anchor.y
      return verticalGap > 0 && verticalGap <= 40 && Math.abs(lineCenter - labelCenter) <= 100
    })
    .sort((a, b) => a.y - b.y)[0]
  if (underline) {
    const width = Math.min(SIGNATURE_WIDTH, underline.width)
    const nearestTextAboveLine = pageText[anchor.pageIndex].items
      .filter((item) => {
        if (item === underline || item.text.startsWith('_')) return false
        const overlapsLine = item.x + item.width >= underline.x
          && item.x <= underline.x + underline.width
        const verticalGap = item.y - underline.y
        return overlapsLine && verticalGap > 0 && verticalGap <= 70
      })
      .sort((a, b) => a.y - b.y)[0]
    const availableHeight = nearestTextAboveLine
      ? nearestTextAboveLine.y + DATE_BASELINE_OFFSET - underline.y - 3
      : SIGNATURE_MAX_HEIGHT
    return {
      pageIndex: anchor.pageIndex,
      x: underline.x + (underline.width - width) / 2,
      y: underline.y,
      width,
      maxHeight: Math.max(8, Math.min(SIGNATURE_MAX_HEIGHT, availableHeight)),
    }
  }
  return {
    pageIndex: anchor.pageIndex,
    x: labelCenter - SIGNATURE_WIDTH / 2,
    y: anchor.y + anchor.height + SIGNATURE_LABEL_GAP,
    width: SIGNATURE_WIDTH,
  }
}

const ROLE_TEXT_PATTERNS: Record<CommitteeRole, RegExp> = {
  director: /DIRECTOR(?:\(A\))?/i,
  'co-director': /CO\s*-\s*DIRECTOR(?:\(A\))?|CODIRECTOR(?:\(A\))?/i,
  tutor: /TUTOR(?:\(A\))?/i,
  external: /EXTERNO(?:\(A\))?|TERNO(?:\(A\))?|EXTERNAL/i,
  synod: /S\s*[IÍ]\s*N\s*O\s*D\s*O/i,
}

async function findCommitteeRoleMark(
  pages: PDFPageProxy[],
  role: CommitteeRole,
): Promise<RoleMark | null> {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const content = await pages[pageIndex].getTextContent()
    const items = content.items.flatMap((item) => {
      if (!('str' in item) || !item.str.trim()) return []
      return [{
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
      }]
    })
    const lines: typeof items[] = []
    for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      let line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 2.5)
      if (!line) {
        line = []
        lines.push(line)
      }
      line.push(item)
    }

    for (const line of lines) {
      line.sort((a, b) => a.x - b.x)
      let combined = ''
      const spans = line.map((item) => {
        const start = combined.length
        combined += `${item.text} `
        return { item, start, end: start + item.text.length }
      })
      const rolePattern = ROLE_TEXT_PATTERNS[role]
      rolePattern.lastIndex = 0
      const roleMatch = rolePattern.exec(combined)
      if (!roleMatch) continue
      if (
        role === 'director'
        && /CO\s*-\s*$/i.test(combined.slice(0, roleMatch.index))
      ) continue

      const roleEnd = roleMatch.index + roleMatch[0].length
      const nextRoleIndex = Object.entries(ROLE_TEXT_PATTERNS)
        .filter(([candidate]) => candidate !== role)
        .map(([, pattern]) => {
          pattern.lastIndex = 0
          return pattern.exec(combined)?.index ?? Number.POSITIVE_INFINITY
        })
        .filter((index) => index > roleEnd)
        .reduce((nearest, index) => Math.min(nearest, index), combined.length)
      const charCenter = (index: number): number | null => {
        const span = spans.find(({ start, end }) => index >= start && index < end)
        if (!span) return null
        const offset = index - span.start
        const charWidth = span.item.width / span.item.text.length
        return span.item.x + (offset + 0.5) * charWidth
      }

      let selectedParen: { open: number; close: number } | null = null
      for (let open = combined.indexOf('(', roleEnd); open >= 0 && open < nextRoleIndex; open = combined.indexOf('(', open + 1)) {
        const close = combined.indexOf(')', open + 1)
        if (close >= 0 && close < nextRoleIndex) selectedParen = { open, close }
      }
      if (!selectedParen) continue

      const openX = charCenter(selectedParen.open)
      const closeX = charCenter(selectedParen.close)
      if (openX === null || closeX === null) continue
      const centerY = line.reduce((total, item) => total + item.y, 0) / line.length
      return {
        role,
        pageIndex,
        x: (openX + closeX) / 2,
        y: centerY,
        hitX: openX,
        hitY: centerY - 9,
        hitWidth: Math.max(8, closeX - openX),
        hitHeight: 18,
      }
    }
  }
  return null
}

function emptyFormValues(): FormValues {
  const today = new Date()
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-')
  return {
    evaluator: '',
    student: '',
    project: '',
    grade: '',
    observations: '',
    date,
    role: '',
    rubricGrades: {},
  }
}

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'include' })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
}

async function createHtmlFilledPdf(
  source: ArrayBuffer,
  layout: FormLayout | null,
  values: FormValues,
  htmlFields: HtmlFieldDefinition[],
  htmlValues: Record<string, string>,
  detectedRoleMark: RoleMark | null,
) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.load(source)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const textColor = rgb(0.08, 0.08, 0.08)

  function drawText(
    pageIndex: number,
    x: number,
    baseline: number,
    width: number,
    value: string,
    options: { centered?: boolean; label?: string } = {},
  ) {
    const text = value.trim()
    if (!text) return
    const page = pdf.getPage(pageIndex)
    const availableWidth = Math.max(1, width - (options.centered ? 0 : 8))
    const textWidth = font.widthOfTextAtSize(text, PDF_FONT_SIZE)
    const size = textWidth > availableWidth
      ? Math.max(7, PDF_FONT_SIZE * availableWidth / textWidth)
      : PDF_FONT_SIZE
    const fittedWidth = font.widthOfTextAtSize(text, size)
    if (fittedWidth > availableWidth + 0.1) {
      throw new Error(`${options.label ?? 'El texto'} no cabe en el espacio del formato.`)
    }
    page.drawText(text, {
      x: options.centered ? x + (width - fittedWidth) / 2 : x + 4,
      y: baseline,
      size,
      font,
      color: textColor,
    })
  }

  for (const field of layout?.fields ?? []) {
    if (field.key === 'date') continue
    if (field.multiline) {
      const words = values[field.key].trim().split(/\s+/).filter(Boolean)
      const page = pdf.getPage(field.pageIndex)
      const maxLines = Math.max(1, Math.floor(field.height / PDF_FONT_SIZE))
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(candidate, PDF_FONT_SIZE) > field.width - 8 && line) {
          lines.push(line)
          line = word
        } else {
          line = candidate
        }
      }
      if (line) lines.push(line)
      if (lines.length > maxLines) {
        throw new Error(`El texto de ${field.label.toLowerCase()} excede el espacio disponible.`)
      }
      lines.slice(0, maxLines).forEach((text, index) => {
        page.drawText(text, {
          x: field.x + 4,
          y: field.y + field.height - PDF_FONT_SIZE * (index + 1),
          size: PDF_FONT_SIZE,
          font,
          color: textColor,
        })
      })
      continue
    }
    drawText(
      field.pageIndex,
      field.x,
      getFieldDisplayY(field),
      field.width,
      values[field.key],
      { centered: field.key === 'grade', label: field.label },
    )
  }

  for (const field of layout?.gradeFields ?? []) {
    drawText(
      field.pageIndex,
      field.x,
      field.y,
      field.width,
      values.rubricGrades[field.id] ?? '',
      { centered: true, label: field.label },
    )
  }

  const [year, month, day] = values.date.split('-')
  const dateValues: Record<DatePart, string> = { day, month, year }
  for (const segment of layout?.dateSegments ?? []) {
    drawText(
      segment.pageIndex,
      segment.x,
      segment.y,
      segment.width,
      dateValues[segment.part],
      { centered: true, label: `Fecha: ${segment.part}` },
    )
  }

  const selectedRole = detectedRoleMark ?? layout?.roles.find((mark) => mark.role === values.role)
  if (selectedRole) {
    const detected = detectedRoleMark === selectedRole
    drawText(
      selectedRole.pageIndex,
      selectedRole.x - 6,
      detected ? selectedRole.y : selectedRole.y - 3,
      12,
      'X',
      { centered: true },
    )
  }

  for (const field of htmlFields) {
      const rawValue = htmlValues[field.id] ?? ''
      if (field.choices) {
        const selectedChoice = field.choices.find((choice) => choice.value === rawValue)
        if (!selectedChoice) continue
        drawText(
          field.pageIndex,
          selectedChoice.x,
          selectedChoice.y,
          selectedChoice.width,
          'X',
          { centered: true, label: `Selección de ${field.label.toLowerCase()}` },
        )
        continue
      }
      if (field.dateSegments) {
        if (!isValidIsoDate(rawValue)) continue
        const [year, month, day] = rawValue.split('-')
        const dateValues: Record<DatePart, string> = {
          day,
          month,
          year: /\bdd\s*\/\s*mm\s*\/\s*aa\b/i.test(field.label) ? year.slice(-2) : year,
        }
        for (const segment of field.dateSegments) {
          drawText(
            field.pageIndex,
            segment.x,
            segment.y,
            segment.width,
            dateValues[segment.part],
            { centered: true, label: `${field.label}: ${segment.part}` },
          )
        }
        continue
      }
      const text = formatHtmlFieldValue(field, rawValue)
      if (!text) continue
      const page = pdf.getPage(field.pageIndex)
      if (field.cover) {
        page.drawRectangle({
          x: field.x - 2,
          y: field.y - 3,
          width: field.width + 4,
          height: field.height + 6,
          color: rgb(1, 1, 1),
        })
      }
      if (field.multiline) {
        const lines: string[] = []
        let line = ''
        for (const word of text.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word
          if (font.widthOfTextAtSize(candidate, PDF_FONT_SIZE) > field.width - 8 && line) {
            lines.push(line)
            line = word
          } else {
            line = candidate
          }
        }
        if (line) lines.push(line)
        const maxLines = Math.max(1, Math.floor(field.height / PDF_FONT_SIZE))
        if (lines.length > maxLines) {
          throw new Error(`El texto de ${field.label.toLowerCase()} excede el espacio disponible.`)
        }
        lines.forEach((textLine, index) => {
          page.drawText(textLine, {
            x: field.x + 4,
            y: field.y + field.height - PDF_FONT_SIZE * (index + 1),
            size: PDF_FONT_SIZE,
            font,
            color: textColor,
          })
        })
      } else {
        drawText(field.pageIndex, field.x, field.y, field.width, text, { label: field.label })
      }
  }
  return pdf
}

async function buildFilledPdf(
  template: FormatTemplate,
  layout: FormLayout | null,
  values: FormValues,
  htmlFields: HtmlFieldDefinition[],
  htmlValues: Record<string, string>,
  signatureTarget: SignatureTarget,
  signaturePng: string,
  detectedRoleMark: RoleMark | null,
) {
  const response = await fetch(`/${encodeURIComponent(template.fileName)}`)
  if (!response.ok) throw new Error(`No se pudo cargar el formato (${response.status}).`)

  const pdf = await createHtmlFilledPdf(
    await response.arrayBuffer(),
    layout,
    values,
    htmlFields,
    htmlValues,
    detectedRoleMark,
  )

  const signatureBytes = Uint8Array.from(
    atob(signaturePng.split(',')[1]),
    (character) => character.charCodeAt(0),
  )
  const signatureImage = await pdf.embedPng(signatureBytes)
  const signatureScale = Math.min(
    1,
    signatureTarget.width / signatureImage.width,
    (signatureTarget.maxHeight ?? SIGNATURE_MAX_HEIGHT) / signatureImage.height,
  )
  const signatureWidth = signatureImage.width * signatureScale
  const signatureHeight = signatureImage.height * signatureScale
  const signaturePage = pdf.getPage(signatureTarget.pageIndex)
  signaturePage.drawImage(signatureImage, {
    x: signatureTarget.x + (signatureTarget.width - signatureWidth) / 2,
    y: signatureTarget.y,
    width: signatureWidth,
    height: signatureHeight,
  })

  return pdf.save()
}

function sha256(data: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', data).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  )
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return buffer
}

type PdfPageViewProps = {
  page: PDFPageProxy
  pageIndex: number
  signatureTarget: SignatureTarget
  signaturePng: string
  signatureSize: SignatureSize | null
  onRenderError: (message: string) => void
}

function PdfPageView({
  page,
  pageIndex,
  signatureTarget,
  signaturePng,
  signatureSize,
  onRenderError,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pageRef = useRef<HTMLDivElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [displayScale, setDisplayScale] = useState(1)
  const viewport = useMemo(() => page.getViewport({ scale: 1 }), [page])

  useEffect(() => {
    const canvas = canvasRef.current
    const pageElement = pageRef.current
    const textLayerElement = textLayerRef.current
    if (!canvas || !pageElement || !textLayerElement) return

    let cancelled = false
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null
    let textLayer: { render: () => Promise<unknown>; cancel: () => void } | null = null
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const renderViewport = page.getViewport({ scale: pixelRatio })
    const context = canvas.getContext('2d')
    if (!context) {
      onRenderError('No se pudo preparar la vista del formato.')
      return
    }

    canvas.width = renderViewport.width
    canvas.height = renderViewport.height
    void import('pdfjs-dist')
      .then(async ({ AnnotationMode, TextLayer }) => {
        if (cancelled) return
        const task = page.render({
          canvasContext: context,
          viewport: renderViewport,
          annotationMode: AnnotationMode.ENABLE_FORMS,
        })
        renderTask = task
        const content = await page.getTextContent()
        if (cancelled) return
        textLayerElement.replaceChildren()
        textLayer = new TextLayer({
          textContentSource: content,
          container: textLayerElement,
          viewport,
        })
        await Promise.all([task.promise, textLayer.render()])
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof Error && cause.name === 'RenderingCancelledException')) return
        onRenderError(cause instanceof Error ? cause.message : String(cause))
      })
    const resizeObserver = new ResizeObserver(([entry]) => {
      setDisplayScale(entry.contentRect.width / viewport.width)
    })
    resizeObserver.observe(pageElement)

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      resizeObserver.disconnect()
    }
  }, [onRenderError, page, viewport, viewport.width])

  return (
    <div
      ref={pageRef}
      className="relative mx-auto mb-6 overflow-hidden bg-white shadow-xl"
      style={{ width: '100%', maxWidth: 1400 }}
      aria-label={`Página ${pageIndex + 1}`}
    >
      <canvas ref={canvasRef} className="block h-auto w-full" />
      <div
        ref={textLayerRef}
        className="format-html-text-layer absolute left-0 top-0"
        style={{
          width: viewport.width,
          height: viewport.height,
          transform: `scale(${displayScale})`,
        }}
        aria-label={`Texto de la página ${pageIndex + 1}`}
      />
      {signaturePng && signatureTarget.pageIndex === pageIndex && (() => {
        const imageScale = signatureSize
          ? Math.min(
              1,
              signatureTarget.width / signatureSize.width,
              (signatureTarget.maxHeight ?? SIGNATURE_MAX_HEIGHT) / signatureSize.height,
            )
          : 1
        const imageWidth = signatureSize ? signatureSize.width * imageScale : signatureTarget.width
        const imageHeight = signatureSize ? signatureSize.height * imageScale : 0
        const [viewX, viewY] = viewport.convertToViewportPoint(
          signatureTarget.x,
          signatureTarget.y + imageHeight,
        )
        return (
          <img
            src={signaturePng}
            alt="Firma manuscrita colocada en el formato"
            className="pointer-events-none absolute z-10 h-auto"
            style={{
              left: (viewX + (signatureTarget.width - imageWidth) / 2) * displayScale,
              top: viewY * displayScale,
              width: imageWidth * displayScale,
            }}
          />
        )
      })()}
    </div>
  )
}

type Props = {
  csrf: string
  onQueueForAssignment: (file: File) => void
}

export default function Formats({ csrf, onQueueForAssignment }: Props) {
  const [selected, setSelected] = useState<FormatTemplate | null>(null)
  const layout = selected ? getFormLayout(selected.fileName) : null
  const readOnly = selected ? READ_ONLY_FORMATS.has(selected.fileName) : false
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pdfPages, setPdfPages] = useState<PDFPageProxy[]>([])
  const [pdfSource, setPdfSource] = useState<ArrayBuffer | null>(null)
  const [signatureTarget, setSignatureTarget] = useState<SignatureTarget | null>(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FormatResult | null>(null)
  const [values, setValues] = useState<FormValues>(emptyFormValues)
  const [htmlFields, setHtmlFields] = useState<HtmlFieldDefinition[]>([])
  const [htmlValues, setHtmlValues] = useState<Record<string, string>>({})
  const [aiTableFields, setAiTableFields] = useState<HtmlFieldDefinition[]>([])
  const [analyzingLayout, setAnalyzingLayout] = useState(false)
  const [aiLayoutAnalyzed, setAiLayoutAnalyzed] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const [signaturePng, setSignaturePng] = useState('')
  const [signatureSize, setSignatureSize] = useState<SignatureSize | null>(null)

  useEffect(() => {
    if (!selected) return

    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    setPdfDocument(null)
    setPdfPages([])
    setPdfSource(null)
    setSignatureTarget(null)
    setHtmlFields([])
    setHtmlValues({})
    setAiTableFields([])
    setAiLayoutAnalyzed(false)
    setLoadingPdf(true)
    setError('')

    const loadPdf = async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        if (cancelled) return
        GlobalWorkerOptions.workerSrc = worker.default
        const response = await fetch(`/${encodeURIComponent(selected.fileName)}`)
        if (!response.ok) throw new Error(`No se pudo cargar el formato (${response.status}).`)
        const source = await response.arrayBuffer()
        task = getDocument({ data: new Uint8Array(source) })
        const document = await task.promise
        const pages = await Promise.all(
          Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)),
        )
        const detectedFields = layout || readOnly ? [] : await detectHtmlFields(pages, selected.fileName)
        const detectedSignatureTarget = await findSignatureTarget(pages)
        if (cancelled) {
          void document.destroy()
          return
        }
        setPdfDocument(document)
        setPdfPages(pages)
        setPdfSource(source.slice(0))
        setSignatureTarget(detectedSignatureTarget ?? layout?.signature ?? getFallbackSignatureTarget(pages))
        setHtmlFields(detectedFields)
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!cancelled) setLoadingPdf(false)
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      if (task) void task.destroy()
    }
  }, [selected, readOnly])

  function selectTemplate(template: FormatTemplate) {
    setSelected(template)
    setResult(null)
    setError('')
    setValues(emptyFormValues())
    setHtmlFields([])
    setHtmlValues({})
    setAiTableFields([])
    setAiLayoutAnalyzed(false)
    setHasSignature(false)
    setSignaturePng('')
    setSignatureSize(null)
    const context = canvasRef.current?.getContext('2d')
    if (context && canvasRef.current) {
      context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }
  }

  function updateField(key: FormFieldKey | 'role', value: string) {
    setValues((current) => key === 'role'
      ? { ...current, role: value as CommitteeRole | '' }
      : { ...current, [key]: value })
    setResult(null)
  }

  function updateGrade(id: string, value: string) {
    setValues((current) => ({
      ...current,
      rubricGrades: { ...current.rubricGrades, [id]: value },
    }))
    setResult(null)
  }

  function updateHtmlField(id: string, value: string) {
    setHtmlValues((current) => ({ ...current, [id]: value }))
    setResult(null)
  }

  async function analyzeSelectedLayout() {
    if (!selected || !pdfSource || analyzingLayout) return
    setAnalyzingLayout(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', new Blob([pdfSource], { type: 'application/pdf' }), selected.fileName)
      const detectedLayout: DocumentAiLayout = await api('/api/formats/analyze', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
        body: form,
      })
      const candidates = buildAiTableFields(detectedLayout)
      const uniqueFields = candidates.filter((candidate) => !htmlFields.some((existing) => {
        if (existing.pageIndex !== candidate.pageIndex) return false
        const overlapX = Math.max(
          0,
          Math.min(existing.x + existing.width, candidate.x + candidate.width) - Math.max(existing.x, candidate.x),
        )
        const overlapY = Math.max(
          0,
          Math.min(existing.y + existing.height, candidate.y + candidate.height) - Math.max(existing.y, candidate.y),
        )
        return overlapX > 0 && overlapY > 0
      }))
      setAiTableFields(uniqueFields)
      setAiLayoutAnalyzed(true)
      setError(uniqueFields.length
        ? `Azure identificó ${uniqueFields.length} campos editables en tablas. Revisa las etiquetas antes de firmar.`
        : 'Azure analizó el diseño, pero no identificó celdas de tabla editables en este formato.')
    } catch (cause) {
      setAiLayoutAnalyzed(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAnalyzingLayout(false)
    }
  }

  function drawSignature(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const position = {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo iniciar el área de firma.')
    if (event.type === 'pointerdown') {
      setResult(null)
      setResult(null)
      setSignaturePng('')
      pointerRef.current = position
      canvas.setPointerCapture(event.pointerId)
      context.lineWidth = 3
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.strokeStyle = '#171717'
      context.beginPath()
      context.arc(position.x, position.y, 1.5, 0, Math.PI * 2)
      context.fillStyle = '#171717'
      context.fill()
      context.beginPath()
      context.moveTo(position.x, position.y)
      setHasSignature(true)
      return
    }
    if (pointerRef.current) {
      context.lineTo(position.x, position.y)
      context.stroke()
      pointerRef.current = position
    }
  }

  function finishSignatureDrawing() {
    pointerRef.current = null
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !hasSignature) return

    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] === 0) continue
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
    if (right < left || bottom < top) return

    const padding = 8
    left = Math.max(0, left - padding)
    top = Math.max(0, top - padding)
    right = Math.min(width - 1, right + padding)
    bottom = Math.min(height - 1, bottom + padding)
    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = right - left + 1
    croppedCanvas.height = bottom - top + 1
    const croppedContext = croppedCanvas.getContext('2d')
    if (!croppedContext) throw new Error('No se pudo recortar la firma.')
    croppedContext.drawImage(
      canvas,
      left,
      top,
      croppedCanvas.width,
      croppedCanvas.height,
      0,
      0,
      croppedCanvas.width,
      croppedCanvas.height,
    )
    setSignatureSize({ width: croppedCanvas.width, height: croppedCanvas.height })
    setSignaturePng(croppedCanvas.toDataURL('image/png'))
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    pointerRef.current = null
    setHasSignature(false)
    setSignaturePng('')
    setSignatureSize(null)
    setResult(null)
  }

  async function signFormat(event: FormEvent) {
    event.preventDefault()
    if (!selected || !canvasRef.current || !hasSignature || (layout && !values.role)) return
    const allHtmlFields = [...htmlFields, ...aiTableFields]
    if (layout && (!values.evaluator.trim() || !values.student.trim() || !values.project.trim() || !values.grade.trim())) {
      setError('Completa el nombre del evaluador, alumno, proyecto y calificación en el documento.')
      return
    }
    const missingGrade = layout?.gradeFields.find((field) => !values.rubricGrades[field.id]?.trim())
    if (missingGrade) {
      setError(`Completa la calificación de: ${missingGrade.label.toLowerCase()}.`)
      return
    }
    const invalidGrade = layout ? [
      { label: 'Calificación asignada', value: values.grade },
      ...layout.gradeFields.map((field) => ({
        label: field.label,
        value: values.rubricGrades[field.id] ?? '',
      })),
    ].find(({ value }) => !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10) : undefined
    if (invalidGrade) {
      setError(`${invalidGrade.label} debe estar entre 0 y 10.`)
      return
    }
    if (!layout && !Object.values(htmlValues).some((value) => value.trim())) {
      setError('Completa al menos un campo HTML detectado en el documento.')
      return
    }
    const invalidHtmlField = allHtmlFields
      .map((field) => ({ field, error: validateHtmlField(field, htmlValues[field.id] ?? '') }))
      .find(({ error: validationError }) => validationError)
    if (invalidHtmlField?.error) {
      setError(invalidHtmlField.error)
      return
    }

    setBusy(true)
    setError('')
    setResult(null)

    try {
      const detectedRoleMark = values.role
        ? await findCommitteeRoleMark(pdfPages, values.role)
        : null
      const unsignedBytes = await buildFilledPdf(
        selected,
        layout,
        values,
        allHtmlFields,
        htmlValues,
        signatureTarget ?? getFallbackSignatureTarget(pdfPages),
        canvasRef.current.toDataURL('image/png'),
        detectedRoleMark,
      )
      const inputBuffer = toArrayBuffer(unsignedBytes)
      const inputSha256 = await sha256(inputBuffer)
      const inputFile = new File([inputBuffer], selected.fileName.replace(/\.pdf$/i, '-llenado.pdf'), {
        type: 'application/pdf',
      })
      const data = await api('/api/direct/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          worker: 'PDFSigner',
          filename: inputFile.name,
          data: await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
            reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el PDF generado.'))
            reader.readAsDataURL(inputFile)
          }),
        }),
      })
      const binary = atob(data.data)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const outputBuffer = toArrayBuffer(bytes)
      const output = new File([outputBuffer], inputFile.name.replace(/-llenado\.pdf$/i, '-firmado.pdf'), {
        type: 'application/pdf',
      })
      const outputSha256 = await sha256(outputBuffer)
      setResult({
        file: output,
        originalSha256: data.sha256_original || inputSha256,
        signedSha256: data.sha256_firmado || outputSha256,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function downloadResult() {
    if (!result) return
    const url = URL.createObjectURL(result.file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.file.name
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="mt-8 spot reveal rounded-2xl border border-ink-line bg-ink-surface p-6 shadow-lg">
      <h2 className="font-display text-2xl">Formatos</h2>
      <p className="mt-1 text-sm text-parchment-muted">
        Completa los campos en el panel izquierdo y consulta el PDF original a la derecha; después dibuja tu firma para generar el documento firmado.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FORMAT_TEMPLATES.map((template) => (
          <button
            key={template.fileName}
            type="button"
            onClick={() => selectTemplate(template)}
            aria-pressed={selected?.fileName === template.fileName}
            className={`rounded-xl border p-4 text-left transition-colors ${
              selected?.fileName === template.fileName
                ? 'border-seal bg-seal/10'
                : 'border-ink-line bg-ink-raised hover:border-seal/50'
            }`}
          >
            <span className="block text-sm font-medium">{template.title}</span>
            <span className="mt-2 block truncate font-mono text-[10px] text-parchment-faint">
              {template.fileName}
            </span>
            {READ_ONLY_FORMATS.has(template.fileName) && (
              <span className="mt-2 inline-block rounded-full border border-ink-line px-2 py-0.5 text-[10px] text-parchment-faint">
                Solo consulta
              </span>
            )}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
          <div className="min-w-0">
            <h3 className="font-display text-xl">Datos del formato</h3>
            {layout && (
              <div className="mt-3 rounded-lg border border-ink-line bg-ink-raised p-3 text-sm text-parchment-muted">
                Completa los campos aquí. El PDF original se muestra a la derecha y conserva su diseño.
                Selecciona también tu cargo en el comité y captura las calificaciones requeridas.
              </div>
            )}
            {readOnly && (
              <p role="status" className="mt-3 rounded-lg border border-ink-line bg-ink-raised p-3 text-sm text-parchment-muted">
                Este documento es solo de consulta; no se mostrará captura ni se generará una copia firmada.
              </p>
            )}
            {!layout && !readOnly && htmlFields.length > 0 && (
              <p role="status" className="mt-3 rounded-lg border border-seal/30 bg-seal/5 p-3 text-sm text-parchment-muted">
                Completa los campos detectados. Los datos se integrarán en el PDF original al generar el documento firmado.
              </p>
            )}
            {!readOnly && pdfSource && (
              <div className="mt-3 grid gap-2 rounded-lg border border-ink-line bg-ink-raised p-3">
                <p className="text-xs text-parchment-muted">
                  El análisis usa Azure Document Intelligence para localizar tablas y celdas. Al iniciarlo, el PDF se envía a Azure.
                </p>
                <button
                  type="button"
                  onClick={() => void analyzeSelectedLayout()}
                  disabled={analyzingLayout}
                  className="btn btn-ghost rounded-lg px-3 py-2 text-sm"
                >
                  {analyzingLayout ? 'Analizando diseño…' : aiLayoutAnalyzed ? 'Volver a analizar con Azure AI' : 'Identificar tablas con Azure AI'}
                </button>
              </div>
            )}
            {!layout && !readOnly && pdfDocument && htmlFields.length === 0 && aiTableFields.length === 0 && (
              <p role="status" className="mt-3 rounded-lg border border-alert/40 bg-alert-bg p-3 text-sm text-alert">
                No se detectaron espacios editables en esta plantilla. No es posible generar un documento llenado
                automáticamente para este archivo.
              </p>
            )}

            {(layout || (!readOnly && (htmlFields.length > 0 || aiTableFields.length > 0))) && (
              <form onSubmit={signFormat} noValidate className="mt-4 grid content-start gap-4">
                {layout && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {layout.fields.map((field) => (
                        <label
                          key={field.key}
                          className={`grid gap-1 text-sm text-parchment-muted ${
                            field.multiline ? 'sm:col-span-2' : ''
                          }`}
                        >
                          <span>{field.label}</span>
                          {field.multiline ? (
                            <textarea
                              value={values[field.key]}
                              onChange={(event) => updateField(field.key, event.target.value)}
                              rows={4}
                              className="format-fill-control min-h-24 w-full resize-y rounded-lg px-3 py-2"
                            />
                          ) : (
                            <input
                              type={field.key === 'date' ? 'date' : field.key === 'grade' ? 'number' : 'text'}
                              min={field.key === 'grade' ? 0 : undefined}
                              max={field.key === 'grade' ? 10 : undefined}
                              step={field.key === 'grade' ? 0.1 : undefined}
                              value={values[field.key]}
                              onChange={(event) => updateField(field.key, event.target.value)}
                              className="format-fill-control w-full rounded-lg px-3 py-2"
                            />
                          )}
                        </label>
                      ))}
                    </div>

                    <label className="grid gap-1 text-sm text-parchment-muted">
                      <span>Cargo en el comité</span>
                      <select
                        value={values.role}
                        onChange={(event) => updateField('role', event.target.value)}
                        className="format-fill-control w-full rounded-lg px-3 py-2"
                      >
                        <option value="">Selecciona un cargo</option>
                        {layout.availableRoles.map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                    </label>

                    {layout.gradeFields.length > 0 && (
                      <fieldset className="grid gap-3 rounded-lg border border-ink-line p-3">
                        <legend className="px-2 text-sm font-semibold text-parchment-muted">Calificaciones</legend>
                        {layout.gradeFields.map((field) => (
                          <label key={field.id} className="grid gap-1 text-sm text-parchment-muted">
                            <span>{field.label}</span>
                            <input
                              type="number"
                              min={0}
                              max={10}
                              step={0.1}
                              value={values.rubricGrades[field.id] ?? ''}
                              onChange={(event) => updateGrade(field.id, event.target.value)}
                              className="format-fill-control w-full rounded-lg px-3 py-2"
                            />
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </>
                )}

                {!layout && htmlFields.map((field) => (
                  <label key={field.id} className="grid gap-1 text-sm text-parchment-muted">
                    <span>{field.label}</span>
                    {field.choices ? (
                      <select
                        value={htmlValues[field.id] ?? ''}
                        onChange={(event) => updateHtmlField(field.id, event.target.value)}
                        required
                        className="format-fill-control w-full rounded-lg px-3 py-2"
                      >
                        <option value="">Selecciona una calificación</option>
                        {field.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>{choice.label}</option>
                        ))}
                      </select>
                    ) : field.multiline ? (
                      <textarea
                        value={htmlValues[field.id] ?? ''}
                        onChange={(event) => updateHtmlField(field.id, event.target.value)}
                        rows={4}
                        className="format-fill-control min-h-24 w-full resize-y rounded-lg px-3 py-2"
                      />
                    ) : (
                      (() => {
                        const input = getHtmlFieldInput(field)
                        const inputType = input.type === 'digits' ? 'text' : input.type
                        return (
                          <input
                            type={inputType}
                            inputMode={input.type === 'digits' ? 'numeric' : undefined}
                            min={input.type === 'number' ? input.min : undefined}
                            max={input.type === 'number' ? input.max : undefined}
                            step={input.type === 'number' ? input.step : undefined}
                            maxLength={input.type === 'email' ? 254 : input.type === 'digits' ? 20 : undefined}
                            value={htmlValues[field.id] ?? ''}
                            onChange={(event) => updateHtmlField(
                              field.id,
                              input.type === 'digits'
                                ? event.target.value.replace(/\D/g, '').slice(0, 20)
                                : event.target.value,
                            )}
                            className="format-fill-control w-full rounded-lg px-3 py-2"
                          />
                        )
                      })()
                    )}
                  </label>
                ))}

                {aiTableFields.length > 0 && (
                  <fieldset className="grid gap-3 rounded-lg border border-seal/40 p-3">
                    <legend className="px-2 text-sm font-semibold text-parchment-muted">
                      Celdas identificadas por Azure AI
                    </legend>
                    {aiTableFields.map((field) => (
                      <label key={field.id} className="grid gap-1 text-sm text-parchment-muted">
                        <span>{field.label}</span>
                        {field.choices ? (
                          <select
                            value={htmlValues[field.id] ?? ''}
                            onChange={(event) => updateHtmlField(field.id, event.target.value)}
                            className="format-fill-control w-full rounded-lg px-3 py-2"
                          >
                            <option value="">Selecciona una opción</option>
                            {field.choices.map((choice) => (
                              <option key={choice.value} value={choice.value}>{choice.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={htmlValues[field.id] ?? ''}
                            onChange={(event) => updateHtmlField(field.id, event.target.value)}
                            className="format-fill-control w-full rounded-lg px-3 py-2"
                          />
                        )}
                      </label>
                    ))}
                  </fieldset>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="format-signature" className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                      Firma manuscrita del administrador
                    </label>
                    <button type="button" onClick={clearSignature} className="link-draw text-xs text-alert">
                      Borrar firma
                    </button>
                  </div>
                  <canvas
                    id="format-signature"
                    ref={canvasRef}
                    width={800}
                    height={220}
                    onPointerDown={drawSignature}
                    onPointerMove={(event) => {
                      if (event.buttons & 1) drawSignature(event)
                    }}
                    onPointerUp={finishSignatureDrawing}
                    onPointerCancel={finishSignatureDrawing}
                    className="mt-2 h-36 w-full touch-none rounded-lg border border-ink-line bg-white"
                    aria-label="Área para dibujar la firma"
                  />
                  {!hasSignature && (
                    <p className="mt-1 text-xs text-parchment-faint">
                      Dibuja tu firma aquí; aparecerá en el PDF original.
                    </p>
                  )}
                </div>

                {error && (
                  <p role="alert" className="rounded-lg border border-alert/40 bg-alert-bg p-3 text-sm text-alert">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || !hasSignature || (layout
                    ? !values.role || !values.evaluator.trim() || !values.student.trim() || !values.project.trim() || !values.grade.trim() || layout.gradeFields.some((field) => !values.rubricGrades[field.id]?.trim())
                    : !htmlFields.length || !Object.values(htmlValues).some((value) => value.trim()))}
                  data-loading={busy}
                  className="btn btn-seal w-full rounded-xl py-3.5 font-medium"
                >
                  {busy ? 'Generando y firmando PDF...' : 'Firmar formato'}
                </button>

                {result && (
                  <div className="rounded-xl border border-verified/40 bg-verified-bg p-4 text-sm text-verified">
                    <p className="font-medium">Formato llenado y firmado correctamente: {result.file.name}</p>
                    <dl className="mt-3 grid gap-2 font-mono text-[10px] text-parchment-muted">
                      <div>
                        <dt>SHA-256 antes de firmar</dt>
                        <dd className="break-all">{result.originalSha256}</dd>
                      </div>
                      <div>
                        <dt>SHA-256 firmado</dt>
                        <dd className="break-all">{result.signedSha256}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" onClick={downloadResult} className="btn btn-fill rounded-lg px-4 py-2 text-sm">
                        Descargar PDF firmado
                      </button>
                      <button
                        type="button"
                        onClick={() => onQueueForAssignment(result.file)}
                        className="btn btn-ghost rounded-lg px-4 py-2 text-sm"
                      >
                        Enviar por asignaciones
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="font-display text-xl">{selected.title} — PDF original</h3>
            {readOnly && (
              <p role="status" className="mt-3 rounded-lg border border-ink-line bg-ink-raised p-3 text-sm text-parchment-muted">
                Este formato es solo de consulta.
              </p>
            )}
            <div className="mt-4 h-[78vh] min-h-[600px] overflow-auto rounded-lg border border-ink-line bg-[#292929] p-4 sm:p-6">
              {loadingPdf && <p className="text-sm text-parchment-muted">Cargando PDF original...</p>}
              {pdfDocument && pdfPages.map((page, pageIndex) => (
                <PdfPageView
                  key={`${selected.fileName}-${pageIndex}`}
                  pageIndex={pageIndex}
                  page={page}
                  signatureTarget={signatureTarget ?? getFallbackSignatureTarget(pdfPages)}
                  signaturePng={signaturePng}
                  signatureSize={signatureSize}
                  onRenderError={setError}
                />
              ))}
            </div>
            {pdfDocument && (
              <p className="mt-2 text-right text-xs text-parchment-faint">
                {pdfDocument.numPages} {pdfDocument.numPages === 1 ? 'página' : 'páginas'}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
