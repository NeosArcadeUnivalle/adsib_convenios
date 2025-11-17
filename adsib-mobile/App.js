import React, { useContext } from "react";
import { Image, Pressable, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { AuthProvider, AuthCtx } from "./src/auth";

import LoginScreen from "./src/screens/LoginScreen";
import ConveniosListScreen from "./src/screens/ConveniosListScreen";
import ConvenioDetailScreen from "./src/screens/ConvenioDetailScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";

const Stack = createNativeStackNavigator();

function LogoutButton() {
  const { logout } = useContext(AuthCtx);
  return (
    <Pressable
      onPress={logout}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 10,
        backgroundColor: "#f59e0b",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: "#0b1220", fontWeight: "900" }}>⎋ Logout</Text>
    </Pressable>
  );
}

function AppStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0b0c0f" },
        headerTintColor: "#f8fafc",
        contentStyle: { backgroundColor: "#0b0c0f" },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "900" },
      }}
    >
      {/* Lista de convenios */}
      <Stack.Screen
        name="Convenios"
        component={ConveniosListScreen}
        options={{
          title: "Convenios",
          headerLeft: () => (
            <Image
              source={require("./assets/adsib.jpg")}
              style={{ width: 28, height: 28, borderRadius: 14, marginRight: 8 }}
            />
          ),
          headerRight: () => <LogoutButton />,
        }}
      />

      {/* Detalle de convenio (flecha back nativa + Logout) */}
      <Stack.Screen
        name="Detalle"
        component={ConvenioDetailScreen}
        options={{
          title: "Detalle",
          headerRight: () => <LogoutButton />,
          headerBackTitleVisible: false,
        }}
      />

      {/* Notificaciones (flecha back nativa + Logout) */}
      <Stack.Screen
        name="Notificaciones"
        component={NotificationsScreen}
        options={{
          title: "Notificaciones",
          headerRight: () => <LogoutButton />,
          headerBackTitleVisible: false,
        }}
      />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#0b0c0f" },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

function RootNav() {
  const { user, ready } = useContext(AuthCtx);
  if (!ready) return null; // pequeño splash mientras carga el estado
  return user ? <AppStack /> : <AuthStack />;
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <RootNav />
      </NavigationContainer>
    </AuthProvider>
  );
}