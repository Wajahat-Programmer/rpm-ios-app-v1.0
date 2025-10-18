import { enableScreens } from 'react-native-screens';
enableScreens();

import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { View, Text, StyleSheet } from 'react-native';
import globalStyles from './globalStyles';
import Login from './Login';
import Home from './Home';
import BloodPressure from './BloodPressure';
import ECG from './ECG';
import Connection from './Connection';
import Settings  from './Settings';
import Profile from './Profile';
import PrivacySecurity from './PrivacySecurityScreen';
import AboutApp from './AboutAppScreen';
import Oxygen from './Oxygen';







export default function App() {
  const Stack = createStackNavigator();

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={Login} />
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="BloodPressure" component={BloodPressure} />
        <Stack.Screen name="Oxygen" component={Oxygen} />
        <Stack.Screen name='ECG' component={ECG}/>
        <Stack.Screen name='Connection' component={Connection}/>
        <Stack.Screen name='Settings' component={Settings}/>
        <Stack.Screen name='Profile' component={Profile}/>
        <Stack.Screen name='PrivacySecurity' component={PrivacySecurity}/>
        <Stack.Screen name='AboutApp' component={AboutApp}/>
        
      </Stack.Navigator>
    </NavigationContainer>
  );
}