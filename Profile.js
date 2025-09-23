import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  TextInput,
  StatusBar,
  Alert,
  Platform, 
  
  
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import globalStyles from './globalStyles';

const { width, height } = Dimensions.get('window');

export default function Profile({ navigation }) {
  const [isEditing, setIsEditing] = useState(false);
  const [userData, setUserData] = useState({
    firstName: 'Mitchell',
    lastName: 'Ryan',
    email: 'ryan.mitchell@email.com',
    phone: '+1 (555) 123-4567',
    dateOfBirth: '1985-06-15',
    gender: 'Male',
    height: '180 cm',
    weight: '82 kg',
    bloodType: 'O+',
    emergencyContact: 'Sarah Mitchell',
    emergencyPhone: '+1 (555) 987-6543'
  });
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [healthDataSharing, setHealthDataSharing] = useState(false);

  const handleBack = () => {
    if (isEditing) {
      Alert.alert(
        'Discard Changes?',
        'Are you sure you want to discard your changes?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Discard', 
            onPress: () => {
              setIsEditing(false);
              navigation.goBack();
            }
          }
        ]
      );
    } else {
      navigation.goBack();
    }
  };

  const handleSave = () => {
    setIsEditing(false);
    Alert.alert('Success', 'Profile updated successfully!');
  };

  const handleEdit = () => {
    setIsEditing(true);
  };

  const handleInputChange = (field, value) => {
    setUserData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const renderEditableField = (label, value, field, keyboardType = 'default') => (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      {isEditing ? (
        <TextInput
          style={styles.textInput}
          value={value}
          onChangeText={(text) => handleInputChange(field, text)}
          keyboardType={keyboardType}
        />
      ) : (
        <Text style={styles.inputValue}>{value}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={globalStyles.primaryColor.color} barStyle="light-content" />
      
      {/* Header - Updated to match BloodPressure.js */}
<SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
  <View style={styles.header}>
    <TouchableOpacity onPress={handleBack}>
      <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>Profile</Text>
    {isEditing ? (
      <TouchableOpacity onPress={handleSave} style={styles.saveButton}>
        <Text style={styles.saveButtonText}>Save</Text>
      </TouchableOpacity>
    ) : (
      <TouchableOpacity onPress={handleEdit} style={styles.editButton}>
        <Text style={styles.editButtonText}>Edit</Text>
      </TouchableOpacity>
    )}
  </View>
</SafeAreaView>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <Image 
              source={require('./assets/avatar.png')} 
              style={styles.avatar} 
            />
            {isEditing && (
              <TouchableOpacity style={styles.cameraButton}>
                <Text style={styles.cameraIcon}>📷</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.userName}>
            {userData.firstName} {userData.lastName}
          </Text>
          <Text style={styles.userEmail}>{userData.email}</Text>
          <Text style={styles.userId}>ID: USR-789456123</Text>
        </View>

        {/* Personal Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.sectionContent}>
            {renderEditableField('First Name', userData.firstName, 'firstName')}
            {renderEditableField('Last Name', userData.lastName, 'lastName')}
            {renderEditableField('Email', userData.email, 'email', 'email-address')}
            {renderEditableField('Phone', userData.phone, 'phone', 'phone-pad')}
          </View>
        </View>
        {/* App Version */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>22 Remote Patient Monitoring Services </Text>
          <Text style={styles.versionNumber}>Version 1.0 (Build 2101)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa'
  },
  // Updated header to match BloodPressure.js
// Replace your header style with this:
header: {
  width: '100%',
  paddingTop: StatusBar.currentHeight, // This adds padding for the status bar
  height: (height * 0.08) + StatusBar.currentHeight, // Add status bar height to your existing height
  backgroundColor: globalStyles.primaryColor.color,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 15,
},
  backIcon: { 
    width: width * 0.06, 
    height: width * 0.06, 
    resizeMode: 'contain', 
    tintColor: '#fff' 
  },
headerTitle: {
  color: 'white',
  fontSize: width * 0.05,
  fontWeight: 'bold',
  flex: 1,
  textAlign: 'center',
},

  editButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: width * 0.04,
    paddingVertical: height * 0.008,
    borderRadius: 16
  },
  editButtonText: {
    color: '#fff',
    fontSize: width * 0.035,
    fontWeight: '600'
  },
  saveButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: width * 0.04,
    paddingVertical: height * 0.008,
    borderRadius: 16
  },
  saveButtonText: {
    color: '#fff',
    fontSize: width * 0.035,
    fontWeight: '600'
  },
  scrollView: {
    flex: 1
  },
  scrollContent: {
    paddingBottom: height * 0.05
  },
  profileHeader: {
    alignItems: 'center',
    padding: width * 0.05,
    backgroundColor: '#fff',
    margin: width * 0.04,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: height * 0.02
  },
  avatar: {
    width: width * 0.25,
    height: width * 0.25,
    borderRadius: width * 0.125,
    borderWidth: 3,
    borderColor: globalStyles.primaryColor.color
  },
  cameraButton: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    backgroundColor: globalStyles.primaryColor.color,
    width: width * 0.08,
    height: width * 0.08,
    borderRadius: width * 0.04,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cameraIcon: {
    fontSize: width * 0.045
  },
  userName: {
    fontSize: width * 0.05,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: height * 0.005
  },
  userEmail: {
    fontSize: width * 0.038,
    color: '#7f8c8d',
    marginBottom: height * 0.002
  },
  userId: {
    fontSize: width * 0.032,
    color: '#bdc3c7'
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: width * 0.04,
    marginBottom: height * 0.025,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: width * 0.04,
    fontWeight: 'bold',
    color: '#2c3e50',
    padding: width * 0.04,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1'
  },
  sectionContent: {
    padding: width * 0.04
  },
  inputGroup: {
    marginBottom: height * 0.02
  },
  inputLabel: {
    fontSize: width * 0.035,
    color: '#7f8c8d',
    marginBottom: height * 0.005,
    fontWeight: '500'
  },
  inputValue: {
    fontSize: width * 0.04,
    color: '#2c3e50',
    fontWeight: '600',
    paddingVertical: height * 0.008
  },
  textInput: {
    fontSize: width * 0.04,
    color: '#2c3e50',
    backgroundColor: '#f8f9fa',
    padding: width * 0.03,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd'
  },
  preferenceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: height * 0.02,
    paddingVertical: height * 0.005
  },
  preferenceInfo: {
    flex: 1
  },
  preferenceTitle: {
    fontSize: width * 0.038,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 2
  },
  preferenceDescription: {
    fontSize: width * 0.032,
    color: '#7f8c8d'
  },
  accountButton: {
    backgroundColor: '#f8f9fa',
    padding: width * 0.04,
    borderRadius: 12,
    marginBottom: height * 0.015,
    alignItems: 'center'
  },
  accountButtonText: {
    fontSize: width * 0.038,
    fontWeight: '600',
    color: globalStyles.primaryColor.color
  },
  deleteButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e74c3c'
  },
  deleteButtonText: {
    color: '#e74c3c'
  },
  versionContainer: {
    alignItems: 'center',
    marginTop: height * 0.02,
    marginBottom: height * 0.01
  },
  versionText: {
    fontSize: width * 0.038,
    color: '#7f8c8d',
    marginBottom: 4
  },
  versionNumber: {
    fontSize: width * 0.032,
    color: '#bdc3c7'
  }
});