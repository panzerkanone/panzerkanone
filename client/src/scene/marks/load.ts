/**
 * The list of the marks' pictures (assets/marks/v1/marks.json, written by tools/battlemarks/ beside them): each
 * picture's file, kind, size and outline, bundled with the table as text and read strictly by the model. The
 * pictures themselves are not here: the scene loads none, and is handed them decoded (client/src/marksart).
 */
import listText from '../../../../assets/marks/v1/marks.json?raw';

export const MARK_LIST_TEXT: string = listText;
