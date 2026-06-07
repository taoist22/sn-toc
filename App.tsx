import React from 'react';
import TOCPanel from './src/TOCPanel';
import {installPluginRouter} from './src/pluginRouter';

installPluginRouter();

export default function App(): React.JSX.Element {
  return <TOCPanel />;
}
