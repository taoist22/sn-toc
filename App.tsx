import React from 'react';
import TOCPanel from './src/screens/TOCPanel';
import {installPluginRouter} from './src/app/pluginRouter';

installPluginRouter();

export default function App(): React.JSX.Element {
  return <TOCPanel />;
}
