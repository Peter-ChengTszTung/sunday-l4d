// Traditional Chinese (zh-Hant), keyed by English source text. See client/src/i18n.ts.
import ui from './ui';
import shared from './shared';
import ch1 from './ch1';
import ch2 from './ch2';
import ch3 from './ch3';
import ch4 from './ch4';
import tools from './tools';

const dict: Record<string, string> = { ...tools, ...shared, ...ch1, ...ch2, ...ch3, ...ch4, ...ui };
export default dict;
