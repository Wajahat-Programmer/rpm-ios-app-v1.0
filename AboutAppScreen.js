import React from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, StatusBar, TouchableOpacity, Dimensions, Image } from 'react-native';
import globalStyles from './globalStyles';
const { width, height } = Dimensions.get('window');



export default function AboutAppScreen({ navigation }) {
      const handleBack = () => {
    navigation.navigate('Settings');
  };
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Image 
            source={require('./assets/icon_back.png')} 
            style={styles.backIcon} 
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About App</Text>
        <View style={styles.headerRightPlaceholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* App Info Card */}
        <View style={styles.card}>
          <View style={styles.appHeader}>
            <Image source={require('./assets/information.png')} style={styles.appIcon} />
            <View>
              <Text style={styles.appName}>22 Remote Patient Monitoring</Text>
              <Text style={styles.version}>Version 1.0 (Build 2101)</Text>
            </View>
          </View>
          
          <Text style={styles.description}>
            22 Remote Patient Monitoring Services helps patients and healthcare providers 
            stay connected through secure monitoring of health metrics and seamless communication.
          </Text>
        </View>

        {/* Features Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Features</Text>
          <View style={styles.featureItem}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.featureText}>Real-time health monitoring</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.featureText}>Secure messaging with healthcare providers</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.featureText}>Medication reminders and tracking</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.featureText}>Health data trends and insights</Text>
          </View>
        </View>

        {/* Legal Links Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <TouchableOpacity 
            style={styles.linkItem}
            onPress={() => Linking.openURL('https://yourwebsite.com/terms')}
          >
            <Text style={styles.linkText}>Terms of Service</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.linkItem}
            onPress={() => Linking.openURL('https://yourwebsite.com/privacy')}
          >
            <Text style={styles.linkText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.linkItem}
            onPress={() => Linking.openURL('https://yourwebsite.com/hipaa')}
          >
            <Text style={styles.linkText}>HIPAA Compliance</Text>
          </TouchableOpacity>
        </View>

        {/* Company Info Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Company</Text>
          <Text style={styles.companyInfo}>
            Developed by TwentyTwo Health Technologies
          </Text>
          <Text style={styles.companyInfo}>
            © 2023 TwentyTwo Health. All rights reserved.
          </Text>
        </View>

        {/* Support Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Text style={styles.supportText}>
            For technical support or questions about the app:
          </Text>
          <TouchableOpacity 
            style={styles.linkItem}
            onPress={() => Linking.openURL('mailto:support@twentytwohealth.com')}
          >
            <Text style={styles.linkText}>support@twentytwohealth.com</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.linkItem}
            onPress={() => Linking.openURL('tel:+18002223333')}
          >
            <Text style={styles.linkText}>1-800-222-3333</Text>
          </TouchableOpacity>
        </View>

        {/* Credits Card */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Credits</Text>
          <Text style={styles.creditText}>
            Built with React Native and other open source technologies.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    width: '100%',
    height: height * 0.08,
    backgroundColor: globalStyles.primaryColor.color,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingTop: 10,
  },
  backButton: {
    padding: 8
  },
  backIcon: {
    width: width * 0.06,
    height: width * 0.06,
    tintColor: '#fff'
  },
  headerTitle: {
    color: '#fff',
    fontSize: width * 0.05,
    fontWeight: 'bold'
  },
  headerRightPlaceholder: {
    width: width * 0.06
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  appIcon: {
    width: 60,
    height: 60,
    marginRight: 16,
  },
  appName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  version: {
    fontSize: 14,
    color: '#666',
  },
  description: {
    fontSize: 16,
    lineHeight: 22,
    color: '#444',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#014e6b',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bullet: {
    marginRight: 8,
    fontSize: 16,
  },
  featureText: {
    fontSize: 16,
    flex: 1,
  },
  linkItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  linkText: {
    fontSize: 16,
    color: '#014e6b',
  },
  companyInfo: {
    fontSize: 16,
    marginBottom: 8,
  },
  supportText: {
    fontSize: 16,
    marginBottom: 12,
  },
  creditText: {
    fontSize: 16,
    fontStyle: 'italic',
    color: '#666',
  },
});