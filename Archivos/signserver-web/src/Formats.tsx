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
}
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
type SignatureTarget = { pageIndex: number; x: number; y: number; width: number }
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
    { id: 'periodo-inicio', label: 'Inicio del periodo académico (dd/mm/aa)', pageIndex: 0, x: 250, y: 590, width: 70, height: 17 },
    { id: 'periodo-fin', label: 'Fin del periodo académico (dd/mm/aa)', pageIndex: 0, x: 435, y: 590, width: 70, height: 17 },
    { id: 'comentarios', label: 'Comentarios sobre la evaluación', pageIndex: 0, x: 64, y: 315, width: 468, height: 74, multiline: true },
    { id: 'avance', label: 'Porcentaje de avance de la tesis', pageIndex: 0, x: 285, y: 292, width: 65, height: 17 },
    { id: 'fecha-evaluacion', label: 'Fecha de evaluación', pageIndex: 0, x: 160, y: 111, width: 160, height: 17 },
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
const FIELD_HEIGHT = 17
const UNDERLINE_TEXT_OFFSET = 3
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
): DateSegmentDefinition[] => positions.map(([part, x, width]) => ({ part, pageIndex, x, y, width }))

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
        y: field.y,
        width: field.width ?? field.maxWidth ?? 0,
        height: field.height,
        multiline: field.multiline,
        cover: field.cover,
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
      y: blankAfterLabel?.y ?? labelItem.y,
      width,
      height: field.height,
      multiline: field.multiline,
      cover: field.cover,
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

  const selectedRole = layout?.roles.find((mark) => mark.role === values.role)
  if (selectedRole) {
    drawText(selectedRole.pageIndex, selectedRole.x - 3, selectedRole.y - 3, 8, 'X', { centered: true })
  }

  if (!layout) {
    for (const field of htmlFields) {
      const text = htmlValues[field.id]?.trim() ?? ''
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
) {
  const response = await fetch(`/${encodeURIComponent(template.fileName)}`)
  if (!response.ok) throw new Error(`No se pudo cargar el formato (${response.status}).`)

  const pdf = await createHtmlFilledPdf(await response.arrayBuffer(), layout, values, htmlFields, htmlValues)

  const signatureBytes = Uint8Array.from(
    atob(signaturePng.split(',')[1]),
    (character) => character.charCodeAt(0),
  )
  const signatureImage = await pdf.embedPng(signatureBytes)
  const signatureScale = Math.min(1, signatureTarget.width / signatureImage.width)
  const signatureWidth = signatureImage.width * signatureScale
  const signatureHeight = signatureImage.height * signatureScale
  const signaturePage = pdf.getPage(signatureTarget.pageIndex)
  signaturePage.drawImage(signatureImage, {
    x: signatureTarget.x,
    y: signatureTarget.y - signatureHeight,
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
  layout: FormLayout | null
  htmlFields: HtmlFieldDefinition[]
  htmlValues: Record<string, string>
  values: FormValues
  signatureTarget: SignatureTarget
  signaturePng: string
  onChangeField: (key: FormFieldKey, value: string) => void
  onChangeGrade: (id: string, value: string) => void
  onChangeDatePart: (part: DatePart, value: string) => void
  onChangeHtmlField: (id: string, value: string) => void
  onSelectRole: (role: CommitteeRole) => void
  onRenderError: (message: string) => void
}

function PdfPageView({
  page,
  pageIndex,
  layout,
  htmlFields,
  htmlValues,
  values,
  signatureTarget,
  signaturePng,
  onChangeField,
  onChangeGrade,
  onChangeDatePart,
  onChangeHtmlField,
  onSelectRole,
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
        aria-label={`Texto HTML de la página ${pageIndex + 1}`}
      />

      {(layout?.fields ?? []).map((field) => {
        if (field.pageIndex !== pageIndex || field.key === 'date') return null
        const [viewX, viewY] = viewport.convertToViewportPoint(field.x, getFieldDisplayY(field))
        const left = viewX * displayScale
        const top = (viewY - PDF_FONT_SIZE * 0.85) * displayScale
        const fontSize = Math.max(10, PDF_FONT_SIZE * displayScale)
        const fieldStyle = {
          left,
          top,
          width: field.width * displayScale,
          height: field.height * displayScale,
          fontSize,
          lineHeight: `${PDF_FONT_SIZE * 1.3 * displayScale}px`,
        }

        return (
          <div
            key={field.key}
            className="absolute z-10"
            style={fieldStyle}
          >
            {field.multiline ? (
              <textarea
                value={values[field.key]}
                onChange={(event) => onChangeField(field.key, event.target.value)}
                aria-label={field.label}
                title={field.label}
                className="format-fill-control h-full w-full resize-none overflow-hidden rounded-[2px] px-1 outline-none"
                style={{ fontFamily: 'Arial, sans-serif', fontSize, lineHeight: fieldStyle.lineHeight }}
              />
            ) : (
              <input
                type={field.key === 'grade' ? 'number' : 'text'}
                min={field.key === 'grade' ? 0 : undefined}
                max={field.key === 'grade' ? 10 : undefined}
                step={field.key === 'grade' ? 0.1 : undefined}
                value={values[field.key]}
                onChange={(event) => onChangeField(field.key, event.target.value)}
                aria-label={field.label}
                title={field.label}
                className="format-fill-control h-full w-full rounded-[2px] px-1 outline-none"
                style={{ fontFamily: 'Arial, sans-serif', fontSize }}
              />
            )}
          </div>
        )
      })}

      {(layout?.gradeFields ?? []).map((field) => {
        if (field.pageIndex !== pageIndex) return null
        const [viewX, viewY] = viewport.convertToViewportPoint(field.x, field.y)
        const fontSize = Math.max(10, PDF_FONT_SIZE * displayScale)
        return (
          <input
            key={field.id}
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={values.rubricGrades[field.id] ?? ''}
            onChange={(event) => onChangeGrade(field.id, event.target.value)}
            aria-label={field.label}
            title={field.label}
            className="format-fill-control absolute z-20 h-auto rounded-[2px] px-1 text-center outline-none"
            style={{
              left: viewX * displayScale,
              top: (viewY - PDF_FONT_SIZE * 0.85) * displayScale,
              width: field.width * displayScale,
              height: field.height * displayScale,
              fontFamily: 'Arial, sans-serif',
              fontSize,
              lineHeight: `${field.height * displayScale}px`,
            }}
          />
        )
      })}

      {(layout?.dateSegments ?? []).map((segment) => {
        if (segment.pageIndex !== pageIndex) return null
        const [year = '', month = '', day = ''] = values.date.split('-')
        const dateValue: Record<DatePart, string> = { day, month, year }
        const [viewX, viewY] = viewport.convertToViewportPoint(segment.x, segment.y)
        const fontSize = Math.max(10, PDF_FONT_SIZE * displayScale)
        return (
          <input
            key={segment.part}
            type="text"
            inputMode="numeric"
            maxLength={segment.part === 'year' ? 4 : 2}
            value={dateValue[segment.part]}
            onChange={(event) => onChangeDatePart(segment.part, event.target.value.replace(/\D/g, ''))}
            aria-label={`Fecha: ${segment.part === 'day' ? 'día' : segment.part === 'month' ? 'mes' : 'año'}`}
            title={`Fecha: ${segment.part === 'day' ? 'día' : segment.part === 'month' ? 'mes' : 'año'}`}
            className="format-fill-control absolute z-20 rounded-[2px] px-1 text-center outline-none"
            style={{
              left: viewX * displayScale,
              top: (viewY - PDF_FONT_SIZE * 0.85) * displayScale,
              width: segment.width * displayScale,
              height: FIELD_HEIGHT * displayScale,
              fontFamily: 'Arial, sans-serif',
              fontSize,
            }}
          />
        )
      })}

      {(layout?.roles ?? []).map((mark) => {
        if (mark.pageIndex !== pageIndex) return null
        const [hitX, hitTop] = viewport.convertToViewportPoint(mark.hitX, mark.hitY + mark.hitHeight)
        const [markX, markY] = viewport.convertToViewportPoint(mark.x, mark.y)
        return (
          <button
            key={mark.role}
            type="button"
            onClick={() => onSelectRole(mark.role)}
            aria-label={`Seleccionar ${ROLE_LABELS[mark.role]} en el comité`}
            aria-pressed={values.role === mark.role}
            title={`Seleccionar ${ROLE_LABELS[mark.role]}`}
            className="absolute z-20 border border-transparent bg-transparent text-black outline-none hover:border-seal/70 hover:bg-white/20 focus:border-seal focus:bg-white/30"
            style={{
              left: hitX * displayScale,
              top: hitTop * displayScale,
              width: mark.hitWidth * displayScale,
              height: mark.hitHeight * displayScale,
            }}
          >
            {values.role === mark.role && (
              <span
                aria-hidden="true"
                className="absolute -translate-x-1/2 -translate-y-1/2 font-bold"
                style={{
                  left: (markX - hitX) * displayScale,
                  top: (markY - hitTop) * displayScale,
                  fontSize: 10 * displayScale,
                  lineHeight: 1,
                }}
              >
                X
              </span>
            )}
          </button>
        )
      })}

      {htmlFields.filter((field) => field.pageIndex === pageIndex).map((field) => {
        const [viewX, viewY] = viewport.convertToViewportPoint(field.x, field.y)
        const fontSize = Math.max(10, PDF_FONT_SIZE * displayScale)
        return (
          field.multiline ? (
            <textarea
              key={field.id}
              value={htmlValues[field.id] ?? ''}
              onChange={(event) => onChangeHtmlField(field.id, event.target.value)}
              aria-label={field.label}
              title={field.label}
              className="format-fill-control absolute z-20 resize-none rounded-[2px] px-1 outline-none"
              style={{
                left: viewX * displayScale,
                top: (viewY - field.height * 0.85) * displayScale,
                width: field.width * displayScale,
                height: field.height * displayScale,
                fontFamily: 'Arial, sans-serif',
                fontSize,
                lineHeight: `${PDF_FONT_SIZE * displayScale}px`,
                backgroundColor: field.cover ? '#fff' : undefined,
              }}
            />
          ) : (
            <input
              key={field.id}
              type="text"
              value={htmlValues[field.id] ?? ''}
              onChange={(event) => onChangeHtmlField(field.id, event.target.value)}
              aria-label={field.label}
              title={field.label}
              className="format-fill-control absolute z-20 rounded-[2px] px-1 outline-none"
              style={{
                left: viewX * displayScale,
                top: (viewY - field.height * 0.85) * displayScale,
                width: field.width * displayScale,
                height: field.height * displayScale,
                fontFamily: 'Arial, sans-serif',
                fontSize,
                backgroundColor: field.cover ? '#fff' : undefined,
              }}
            />
          )
        )
      })}

      {signaturePng && signatureTarget.pageIndex === pageIndex && (() => {
        const [viewX, viewY] = viewport.convertToViewportPoint(signatureTarget.x, signatureTarget.y)
        return (
          <img
            src={signaturePng}
            alt="Firma manuscrita colocada en el formato"
            className="pointer-events-none absolute z-10 h-auto"
            style={{
              left: viewX * displayScale,
              top: viewY * displayScale,
              width: signatureTarget.width * displayScale,
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
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<FormatResult | null>(null)
  const [values, setValues] = useState<FormValues>(emptyFormValues)
  const [htmlFields, setHtmlFields] = useState<HtmlFieldDefinition[]>([])
  const [htmlValues, setHtmlValues] = useState<Record<string, string>>({})
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const [signaturePng, setSignaturePng] = useState('')

  useEffect(() => {
    if (!selected) return

    let cancelled = false
    let task: PDFDocumentLoadingTask | null = null
    setPdfDocument(null)
    setPdfPages([])
    setHtmlFields([])
    setHtmlValues({})
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
        if (cancelled) {
          void document.destroy()
          return
        }
        setPdfDocument(document)
        setPdfPages(pages)
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
    setHasSignature(false)
    setSignaturePng('')
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

  function updateDatePart(part: DatePart, value: string) {
    setValues((current) => {
      const [year = '', month = '', day = ''] = current.date.split('-')
      const parts: Record<DatePart, string> = { day, month, year }
      parts[part] = value
      return { ...current, date: `${parts.year}-${parts.month}-${parts.day}` }
    })
    setResult(null)
  }

  function updateHtmlField(id: string, value: string) {
    setHtmlValues((current) => ({ ...current, [id]: value }))
    setResult(null)
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
    if (canvasRef.current && hasSignature) {
      setSignaturePng(canvasRef.current.toDataURL('image/png'))
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
    pointerRef.current = null
    setHasSignature(false)
    setSignaturePng('')
    setResult(null)
  }

  async function signFormat(event: FormEvent) {
    event.preventDefault()
    if (!selected || !canvasRef.current || !hasSignature || (layout && !values.role)) return
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

    setBusy(true)
    setError('')
    setResult(null)

    try {
      const unsignedBytes = await buildFilledPdf(
        selected,
        layout,
        values,
        htmlFields,
        htmlValues,
        layout?.signature ?? getFallbackSignatureTarget(pdfPages),
        canvasRef.current.toDataURL('image/png'),
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
        Completa los campos HTML sobre la vista del documento, dibuja tu firma y genera el PDF para firmarlo.
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
        <div className="mt-8 grid grid-cols-1 gap-6">
          <div className="min-w-0">
            <h3 className="font-display text-xl">{selected.title}</h3>
            {layout && (
              <div className="mt-3 rounded-lg border border-ink-line bg-ink-raised p-3 text-sm text-parchment-muted">
                Completa los campos HTML directamente sobre el documento. Selecciona el cargo del comité y
                captura cada calificación (escala 0–10) en su casilla.
              </div>
            )}
            {readOnly && (
              <p role="status" className="mt-3 rounded-lg border border-ink-line bg-ink-raised p-3 text-sm text-parchment-muted">
                Este documento es solo de consulta; no se mostrará captura HTML ni se generará una copia firmada.
              </p>
            )}
            {!layout && !readOnly && htmlFields.length > 0 && (
              <p role="status" className="mt-3 rounded-lg border border-seal/30 bg-seal/5 p-3 text-sm text-parchment-muted">
                Se detectaron {htmlFields.length} espacios de captura. Los campos aparecen como controles HTML
                sobre la plantilla; revisa la posición antes de generar el PDF.
              </p>
            )}
            {!layout && !readOnly && pdfDocument && htmlFields.length === 0 && (
              <p role="status" className="mt-3 rounded-lg border border-alert/40 bg-alert-bg p-3 text-sm text-alert">
                No se detectaron espacios editables en esta plantilla. No es posible generar un documento llenado
                automáticamente para este archivo.
              </p>
            )}

            <div className="mt-4 h-[78vh] min-h-[600px] overflow-auto rounded-lg border border-ink-line bg-[#292929] p-4 sm:p-6">
              {loadingPdf && <p className="text-sm text-parchment-muted">Cargando páginas del formato...</p>}
              {pdfDocument && pdfPages.map((page, pageIndex) => (
                  <PdfPageView
                    key={`${selected.fileName}-${pageIndex}`}
                    pageIndex={pageIndex}
                    page={page}
                    layout={layout}
                    htmlFields={htmlFields}
                    htmlValues={htmlValues}
                    values={values}
                    signatureTarget={layout?.signature ?? getFallbackSignatureTarget(pdfPages)}
                    signaturePng={signaturePng}
                    onChangeField={updateField}
                    onChangeGrade={updateGrade}
                    onChangeDatePart={updateDatePart}
                    onChangeHtmlField={updateHtmlField}
                    onSelectRole={(role) => updateField('role', role)}
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

          {(layout || (!readOnly && htmlFields.length > 0)) && <form onSubmit={signFormat} className="grid content-start gap-4">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="format-signature" className="text-xs font-semibold uppercase tracking-wider text-parchment-muted">
                  Firma manuscrita del administrador
                </label>
                <button type="button" onClick={clearSignature} className="link-draw text-xs text-alert">
                  Borrar firma
                </button>
              </div>
              <div className="mt-2 max-w-3xl">
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
                  className="h-36 w-full touch-none rounded-lg border border-ink-line bg-white"
                  aria-label="Área para dibujar la firma"
                />
              </div>
              {!hasSignature && (
                <p className="mt-1 text-xs text-parchment-faint">
                  Dibuja tu firma aquí; aparecerá automáticamente en el espacio de firma del formato.
                </p>
              )}
              {hasSignature && (
                <p className="mt-1 text-xs text-verified">
                  {layout
                    ? 'La firma se colocará en el espacio impreso.'
                    : 'La firma se colocará al final del documento.'}
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
          </form>}
        </div>
      )}
    </section>
  )
}
